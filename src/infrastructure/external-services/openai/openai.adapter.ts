import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import {
  IAIAnalyzerPort,
  AIAnalyzeParams,
  AIAnalysisResult,
  IYouTubeExtractorPort,
} from '@/application/ports';
import { INJECTION_TOKENS } from '@/shared/constants';
import { Inject } from '@nestjs/common';
import {
  buildContentExtractionPrompt,
  buildTMDBSelectionPrompt,
  buildUnifiedAnalysisPrompt,
} from './prompts';

/**
 * OpenAI 어댑터
 * AI 기반 비디오 콘텐츠 분석
 */
@Injectable()
export class OpenAIAdapter implements IAIAnalyzerPort {
  private readonly logger = new Logger(OpenAIAdapter.name);
  private openai: OpenAI | null = null;
  private readonly model: string;
  private lastFullTranscript = '';

  // 자막 캐싱 (동일 videoId 중복 fetch 방지)
  private transcriptCache = new Map<string, { content: string; transcript: string; timestamp: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5분

  constructor(
    private readonly configService: ConfigService,
    @Inject(INJECTION_TOKENS.YOUTUBE_EXTRACTOR)
    private readonly youtubeExtractor: IYouTubeExtractorPort,
  ) {
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o-mini');

    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - AI analysis will fall back to keyword analysis');
    }
  }

  private getOpenAI(): OpenAI {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured');
    }
    return this.openai;
  }

  async analyzeVideoContent(params: AIAnalyzeParams): Promise<AIAnalysisResult> {
    const { videoId, videoDuration, tmdbCandidates } = params;

    const content = await this.extractVideoContentCached(videoId);
    const segments = this.getTranscriptSegments();
    const enhancedContent = this.buildEnhancedContent(content, segments);

    // 통합 프롬프트 사용 (한 번의 호출로 제목 추출 + TMDB 선택 + 결말 판단)
    const prompt = buildUnifiedAnalysisPrompt(enhancedContent, tmdbCandidates, videoDuration);

    try {
      const response = await this.getOpenAI().chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              '당신은 YouTube 영화/드라마 콘텐츠 분석 전문가입니다. 주어진 텍스트에서 정확한 영화/드라마 제목을 추출하고, 스포일러나 결말 내용 포함 여부를 판단하며, TMDB 후보들 중 가장 적합한 작품을 선택해주세요.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1200,
      });

      const result = response.choices[0]?.message?.content || '';
      return this.parseAnalysisResponse(result, content);
    } catch (error) {
      this.logger.warn(
        `AI analysis failed, falling back to keyword analysis: ${(error as Error).message}`,
      );
      return this.keywordAnalysis(content);
    }
  }

  async analyzeEndingContent(
    videoId: string,
    videoDuration: number,
  ): Promise<{
    includesEnding: boolean;
    confidence: number;
    reasoning: string;
  }> {
    const result = await this.analyzeVideoContent({
      videoId,
      videoDuration,
      tmdbCandidates: [],
    });

    return {
      includesEnding: result.includesEnding,
      confidence: result.confidence,
      reasoning: result.reasoning,
    };
  }

  private async extractVideoContentCached(videoId: string): Promise<string> {
    // 캐시 확인
    const cached = this.transcriptCache.get(videoId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      this.lastFullTranscript = cached.transcript;
      return cached.content;
    }

    // 캐시 미스 - 새로 fetch
    const content = await this.extractVideoContent(videoId);

    // 캐시 저장
    this.transcriptCache.set(videoId, {
      content,
      transcript: this.lastFullTranscript,
      timestamp: Date.now(),
    });

    // 오래된 캐시 정리 (10개 초과 시)
    if (this.transcriptCache.size > 10) {
      const oldestKey = this.transcriptCache.keys().next().value;
      if (oldestKey) this.transcriptCache.delete(oldestKey);
    }

    return content;
  }

  private async extractVideoContent(videoId: string): Promise<string> {
    const videoInfo = await this.youtubeExtractor.getVideoInfoWithTranscript(videoId);

    const title = videoInfo.title || '';
    const description = videoInfo.description || '';

    this.lastFullTranscript = videoInfo.transcript || '';
    const transcriptText = this.lastFullTranscript.substring(0, 500);

    return [
      `제목: ${title}`,
      `설명: ${description || '설명 없음'}`,
      transcriptText ? `자막: ${transcriptText}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private getTranscriptSegments(): { start: string; end: string } {
    if (!this.lastFullTranscript || this.lastFullTranscript.length < 600) {
      return { start: this.lastFullTranscript, end: '' };
    }
    return {
      start: this.lastFullTranscript.substring(0, 300),
      end: this.lastFullTranscript.substring(this.lastFullTranscript.length - 300),
    };
  }

  private buildEnhancedContent(
    content: string,
    segments: { start: string; end: string },
  ): string {
    const parts = [content];
    if (segments.start) {
      parts.push(`\n=== 자막 시작 부분 (300자) ===\n${segments.start}`);
    }
    if (segments.end) {
      parts.push(`\n=== 자막 끝 부분 (300자) ===\n${segments.end}`);
    }
    return parts.join('\n\n');
  }

  private parseAnalysisResponse(
    aiResponse: string,
    originalContent: string,
  ): AIAnalysisResult {
    try {
      const jsonMatch = aiResponse.trim().match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        const result: AIAnalysisResult = {
          includesEnding: parsed.includes_ending || false,
          confidence: parsed.confidence || 50,
          reasoning: parsed.reasoning || '통합 분석 완료',
          extractedContent: originalContent.substring(0, 500),
          extractedTitles: parsed.extracted_titles || [],
        };

        if (parsed.selected_tmdb) {
          result.selectedTMDBMatch = {
            tmdbId: parsed.selected_tmdb.tmdb_id,
            type: parsed.selected_tmdb.type,
            confidence: parsed.selected_tmdb.confidence || 0,
            reasoning: parsed.selected_tmdb.reasoning || 'AI 선택',
          };
        }

        return result;
      }
    } catch {
      this.logger.warn('Failed to parse AI response as JSON');
    }

    return this.keywordAnalysis(originalContent);
  }

  private keywordAnalysis(content: string): AIAnalysisResult {
    const endingKeywords = [
      '결말포함',
      '결말',
      '엔딩',
      '스포일러',
      '스포',
      '최종화',
      '마지막',
      '완결',
      '반전',
    ];

    let keywordCount = 0;
    const foundKeywords: string[] = [];

    for (const keyword of endingKeywords) {
      if (content.toLowerCase().includes(keyword)) {
        keywordCount++;
        foundKeywords.push(keyword);
      }
    }

    const includesEnding = keywordCount >= 2 || content.includes('결말포함');
    const confidence = includesEnding ? Math.min(70, keywordCount * 25) : 30;

    return {
      includesEnding,
      confidence,
      reasoning:
        foundKeywords.length > 0
          ? `키워드 기반 분석: ${foundKeywords.join(', ')} 발견`
          : '결말 관련 키워드 없음',
      extractedContent: content.substring(0, 500),
      extractedTitles: [],
    };
  }
}
