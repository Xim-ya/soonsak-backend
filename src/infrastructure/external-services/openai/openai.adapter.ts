import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import {
  IAIAnalyzerPort,
  AIAnalyzeParams,
  AIAnalysisResult,
  DirectExtractionParams,
  DirectExtractionResult,
  IYouTubeExtractorPort,
} from '@/application/ports';
import { INJECTION_TOKENS, AI_CONFIG } from '@/shared/constants';
import { AIAnalysisError } from '@/domain/errors/domain.error';
import { retryWithBackoff } from '@/shared/utils/async.util';
import { buildUnifiedAnalysisPrompt, buildDirectExtractionPrompt } from './prompts';

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

  /**
   * Phase 1: 직접 추출 (Simple Extraction)
   * 자막에서 명시적으로 언급된 제목만 추출
   * confidence >= 80이면 Phase 2 스킵 가능
   */
  async extractDirectMention(params: DirectExtractionParams): Promise<DirectExtractionResult> {
    const { videoId, videoTitle, videoDescription, videoDuration } = params;

    this.logger.log(`[Phase 1] Direct extraction for video: ${videoId}`);

    try {
      // 자막 가져오기 (캐시 활용, lastFullTranscript 업데이트됨)
      await this.extractVideoContentCached(videoId);
      const fullTranscript = this.lastFullTranscript;

      // 자막 세그먼트 추출 (앞부분 800자, 중간 60~80% 1000자, 뒷부분 300자)
      const len = fullTranscript.length;
      const transcriptStart = fullTranscript.substring(0, 800);

      // 중간 세그먼트: 60~80% 지점에서 1000자 (작중 대사에서 제목 힌트 추출용)
      // 영화/드라마 리뷰 중반~후반에 제목이 재언급되는 경우가 많음
      const middleStart = Math.floor(len * 0.6);
      const middleLen = 1000;
      const transcriptMiddle = len > 1500
        ? fullTranscript.substring(middleStart, middleStart + middleLen)
        : '';

      // transcriptEnd: 800자로 증가 (결말 판단을 위해 충분한 내용 전달)
      const transcriptEnd = len > 1000
        ? fullTranscript.substring(Math.max(0, len - 800))
        : '';

      this.logger.log(`[Phase 1] Transcript length: ${len}`);

      // 사전 패턴 매칭: "저 XXX 기자예요" 패턴 스캔
      const dialogueHint = this.extractDialoguePatternHint(fullTranscript);
      if (dialogueHint) {
        this.logger.log(`[Phase 1] Found dialogue pattern hint: "${dialogueHint}"`);
      }

      const prompt = buildDirectExtractionPrompt({
        videoTitle,
        videoDescription,
        transcriptStart,
        transcriptMiddle,
        transcriptEnd,
        dialogueHint: dialogueHint || undefined,
        runtimeSeconds: videoDuration,
      });

      const response = await retryWithBackoff(
        () => this.getOpenAI().chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: '당신은 YouTube 영화/드라마 리뷰 영상에서 작품 제목을 정확하게 추출하는 전문가입니다. 명시적으로 언급된 제목만 추출하고, 일반 명사나 클릭베이트를 제목으로 착각하지 마세요. 반드시 JSON으로 응답하세요.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        }),
        { maxRetries: 2, baseDelay: 1000 },
      );

      const result = response.choices[0]?.message?.content || '';
      this.logger.log(`[Phase 1] Raw response: ${result.substring(0, 300)}`);

      return this.parseDirectExtractionResponse(result);
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.logger.warn(`[Phase 1] Direct extraction failed: ${errorMessage}`);

      // Phase 1 실패 시 빈 결과 반환 (Phase 2로 진행)
      return {
        extractedTitle: null,
        confidence: 0,
        mediaTypeHint: null,
        reasoning: `Phase 1 실패: ${errorMessage}`,
        includesEnding: false,
      };
    }
  }

  /**
   * Phase 1 응답 파싱
   */
  private parseDirectExtractionResponse(aiResponse: string): DirectExtractionResult {
    try {
      const parsed = JSON.parse(aiResponse.trim());

      return {
        extractedTitle: parsed.extracted_title || null,
        confidence: parsed.confidence || 0,
        mediaTypeHint: this.parseMediaTypeHint(parsed.media_type_hint),
        reasoning: parsed.reasoning || '',
        includesEnding: parsed.includes_ending || false,
      };
    } catch {
      this.logger.warn('[Phase 1] Failed to parse JSON response');
      return {
        extractedTitle: null,
        confidence: 0,
        mediaTypeHint: null,
        reasoning: 'JSON 파싱 실패',
        includesEnding: false,
      };
    }
  }

  /**
   * 미디어 타입 힌트 파싱
   */
  private parseMediaTypeHint(hint: string | null | undefined): 'movie' | 'tv' | 'anime' | 'documentary' | null {
    if (!hint) return null;
    const normalized = hint.toLowerCase();
    if (normalized === 'movie') return 'movie';
    if (normalized === 'tv') return 'tv';
    if (normalized === 'anime') return 'anime';
    if (normalized === 'documentary') return 'documentary';
    return null;
  }

  /**
   * Phase 2: 추론 분석 (Inference)
   * 줄거리 기반 추론, 웹 검색어 생성 등 복잡한 분석
   */
  async analyzeVideoContent(params: AIAnalyzeParams): Promise<AIAnalysisResult> {
    const { videoId, videoDuration, tmdbCandidates } = params;

    const content = await this.extractVideoContentCached(videoId);
    const segments = this.getTranscriptSegments();
    const enhancedContent = this.buildEnhancedContent(content, segments);

    // 통합 프롬프트 사용 (한 번의 호출로 제목 추출 + TMDB 선택 + 결말 판단)
    const prompt = buildUnifiedAnalysisPrompt(enhancedContent, tmdbCandidates, videoDuration);

    try {
      const response = await retryWithBackoff(
        () => this.getOpenAI().chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                '당신은 YouTube 영화/드라마 콘텐츠 분석 전문가입니다. 주어진 텍스트에서 정확한 영화/드라마 제목을 추출하고, 스포일러나 결말 내용 포함 여부를 판단하며, TMDB 후보들 중 가장 적합한 작품을 선택해주세요. 반드시 JSON으로 응답하세요.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 1200,
          response_format: { type: 'json_object' },
        }),
        { maxRetries: 2, baseDelay: 1000 },
      );

      const result = response.choices[0]?.message?.content || '';
      // 디버그: AI 응답 원본 로그 (장르/연도 필드 확인용)
      this.logger.log(`AI raw response (first 800 chars): ${result.substring(0, 800)}`);
      return this.parseAnalysisResponse(result, content);
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.logger.warn(
        `AI analysis failed, falling back to keyword analysis: ${errorMessage}`,
      );
      throw new AIAnalysisError(errorMessage);
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
    if (cached && Date.now() - cached.timestamp < AI_CONFIG.CACHE_TTL_MS) {
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

    // 오래된 캐시 정리
    if (this.transcriptCache.size > AI_CONFIG.MAX_TRANSCRIPT_CACHE_SIZE) {
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
    const transcriptText = this.lastFullTranscript.substring(0, 5000);

    return [
      `제목: ${title}`,
      `설명: ${description || '설명 없음'}`,
      transcriptText ? `자막: ${transcriptText}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private getTranscriptSegments(): {
    start: string;
    earlyMid: string;
    middle: string;
    lateMid: string;
    end: string;
  } {
    if (!this.lastFullTranscript || this.lastFullTranscript.length < 1000) {
      return { start: this.lastFullTranscript, earlyMid: '', middle: '', lateMid: '', end: '' };
    }

    const len = this.lastFullTranscript.length;

    // 시작 구간: 0~800자 (리뷰어가 영화 제목을 소개하는 구간)
    const start = this.lastFullTranscript.substring(0, 800);

    // 초반 중간: 20% 지점, 500자
    const earlyMidStart = Math.max(0, Math.floor(len * 0.2) - 250);
    const earlyMid = this.lastFullTranscript.substring(earlyMidStart, earlyMidStart + 500);

    // 중간: 40% 지점, 500자 (리뷰어가 제목을 재언급하는 구간)
    const middleStart = Math.max(0, Math.floor(len * 0.4) - 250);
    const middle = this.lastFullTranscript.substring(middleStart, middleStart + 500);

    // 후반 중간: 65% 지점, 500자
    const lateMidStart = Math.max(0, Math.floor(len * 0.65) - 250);
    const lateMid = this.lastFullTranscript.substring(lateMidStart, lateMidStart + 500);

    // 끝: 마지막 400자 (결론부, 제목 재언급 가능)
    const end = this.lastFullTranscript.substring(len - 400);

    return { start, earlyMid, middle, lateMid, end };
  }

  private buildEnhancedContent(
    content: string,
    segments: { start: string; earlyMid: string; middle: string; lateMid: string; end: string },
  ): string {
    const parts = [content];
    if (segments.start) {
      parts.push(`\n=== 자막 시작 부분 (0%) ===\n${segments.start}`);
    }
    if (segments.earlyMid) {
      parts.push(`\n=== 자막 초반 중간 (20%) ===\n${segments.earlyMid}`);
    }
    if (segments.middle) {
      parts.push(`\n=== 자막 중간 부분 (40%) ===\n${segments.middle}`);
    }
    if (segments.lateMid) {
      parts.push(`\n=== 자막 후반 중간 (65%) ===\n${segments.lateMid}`);
    }
    if (segments.end) {
      parts.push(`\n=== 자막 끝 부분 (100%) ===\n${segments.end}`);
    }
    return parts.join('\n\n');
  }

  private parseAnalysisResponse(
    aiResponse: string,
    originalContent: string,
  ): AIAnalysisResult {
    try {
      const parsed = JSON.parse(aiResponse.trim());

      const result: AIAnalysisResult = {
        includesEnding: parsed.includes_ending || false,
        confidence: parsed.confidence || 50,
        reasoning: parsed.reasoning || '통합 분석 완료',
        extractedContent: originalContent.substring(0, 500),
        extractedTitles: parsed.extracted_titles || [],
        inferredTitles: parsed.inferred_titles || [],
        englishTitles: parsed.english_titles || [],
        inferredYear: parsed.inferred_year || null,
        inferredGenres: parsed.inferred_genres || [],
        searchQueries: parsed.search_queries || [],
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
    } catch {
      this.logger.warn('Failed to parse AI response as JSON, falling back to keyword analysis');
      return this.keywordAnalysis(originalContent);
    }
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

  /**
   * 자막에서 대사 패턴 힌트 추출
   * "저 XXX 기자예요", "XXX 방송국", "XXX 신문사" 등의 패턴에서 기관명 추출
   */
  private extractDialoguePatternHint(transcript: string): string | null {
    // 기자/방송국/신문사 패턴
    const patterns = [
      // "저 XXX 기자예요" / "저 XXX OOO 기자입니다"
      /저\s+([가-힣]{2,10})\s+(?:[가-힣]{2,5}\s+)?기자(?:예요|입니다|에요)/,
      // "XXX 방송국" / "XXX 신문사" / "XXX 뉴스"
      /([가-힣]{2,10})\s+(?:방송국|신문사|뉴스|미디어|언론사)/,
      // "XXX에서 일하는"
      /([가-힣]{2,10})에서\s+일하는/,
    ];

    for (const pattern of patterns) {
      const match = transcript.match(pattern);
      if (match && match[1]) {
        const candidate = match[1].trim();
        // 일반 명사 필터링
        const commonNouns = ['저희', '우리', '내가', '제가', '거기', '여기', '그곳', '이곳'];
        if (!commonNouns.includes(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

}
