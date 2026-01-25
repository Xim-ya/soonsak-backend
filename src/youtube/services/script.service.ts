import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import { ScriptAnalysisResult, TMDBMatchResult } from '@/common/types';
import { YouTubeException } from '@/common/exceptions';
import { YouTubeExtractorService } from './extractor.service';

/**
 * YouTube 스크립트 분석 서비스
 * 자막 추출 및 AI 기반 분석 처리
 */
@Injectable()
export class YouTubeScriptService {
  private readonly logger = new Logger(YouTubeScriptService.name);
  private readonly openai: OpenAI;
  private readonly model: string;
  private lastFullTranscript = '';

  constructor(
    private readonly configService: ConfigService,
    private readonly extractorService: YouTubeExtractorService,
  ) {
    const apiKey = this.configService.getOrThrow<string>('OPENAI_API_KEY');
    this.openai = new OpenAI({ apiKey });
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
  }

  /**
   * 비디오 콘텐츠 추출 (제목, 설명, 자막)
   */
  async extractVideoContent(videoId: string): Promise<string> {
    try {
      const videoInfo = await this.extractorService.getVideoInfo(videoId);

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
    } catch (error) {
      throw YouTubeException.contentExtractionFailed(error as Error);
    }
  }

  /**
   * 분석용 자막 세그먼트 조회
   */
  private getTranscriptSegments(): { start: string; end: string } {
    if (!this.lastFullTranscript || this.lastFullTranscript.length < 600) {
      return { start: this.lastFullTranscript, end: '' };
    }
    return {
      start: this.lastFullTranscript.substring(0, 300),
      end: this.lastFullTranscript.substring(this.lastFullTranscript.length - 300),
    };
  }

  /**
   * 비디오 제목 추출 및 결말 포함 여부 분석
   */
  async analyzeVideoWithTMDBCandidates(
    videoId: string,
    runtimeSeconds?: number,
    tmdbCandidates?: TMDBMatchResult[],
  ): Promise<ScriptAnalysisResult> {
    const content = await this.extractVideoContent(videoId);
    const segments = this.getTranscriptSegments();

    const enhancedContent = this.buildEnhancedContent(content, segments);
    const prompt = this.buildAnalysisPrompt(enhancedContent, runtimeSeconds, tmdbCandidates);

    try {
      const response = await this.openai.chat.completions.create({
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
      this.logger.warn(`AI analysis failed, falling back to keyword analysis: ${(error as Error).message}`);
      return this.keywordAnalysis(content);
    }
  }

  /**
   * 자막 세그먼트가 포함된 향상된 콘텐츠 구성
   */
  private buildEnhancedContent(content: string, segments: { start: string; end: string }): string {
    const parts = [content];
    if (segments.start) {
      parts.push(`\n=== 자막 시작 부분 (300자) ===\n${segments.start}`);
    }
    if (segments.end) {
      parts.push(`\n=== 자막 끝 부분 (300자) ===\n${segments.end}`);
    }
    return parts.join('\n\n');
  }

  /**
   * AI 분석 프롬프트 구성
   */
  private buildAnalysisPrompt(
    content: string,
    runtimeSeconds?: number,
    tmdbCandidates?: TMDBMatchResult[],
  ): string {
    const runtimeInfo = runtimeSeconds
      ? `\n영상 재생 시간: ${runtimeSeconds}초 (${Math.round(runtimeSeconds / 60)}분)`
      : '';

    if (!tmdbCandidates || tmdbCandidates.length === 0) {
      return `당신은 YouTube 영화/드라마 리뷰 영상 분석 전문가입니다.

아래의 **제목**, **설명**, **자막**을 종합적으로 분석하여 이 영상에서 다루는 영화/드라마의 제목을 추출해주세요.${runtimeInfo}

=== 분석 대상 ===
${content}

=== 분석 방법 ===
1. **자막 분석 (가장 중요)**
   - 자막에서 영화/드라마 제목이 직접 언급되는 부분을 찾으세요
   - "오늘 소개할 영화는 XXX", "XXX라는 영화", "XXX 리뷰" 등의 패턴을 찾으세요

2. **설명 분석**
   - 영상 설명에 영화 제목이 포함되어 있는지 확인하세요

3. **제목 분석**
   - 영상 제목에서 영화명을 유추할 수 있는 단서를 찾으세요

=== 추출 규칙 ===
- 반드시 **명시적으로 언급된 제목**만 추출하세요
- 줄거리나 내용으로 추측하지 마세요
- 배우, 감독, 채널 이름은 제외
- 한국어 제목과 영어 원제 모두 추출
- 확신이 70% 미만이면 빈 배열 반환

=== 응답 형식 (JSON만) ===
{
  "extracted_titles": ["찾은 제목들"],
  "includes_ending": true/false,
  "confidence": 0-100,
  "source": "title/description/transcript 중 어디서 찾았는지",
  "reasoning": "구체적인 발견 근거"
}`;
    }

    const candidatesInfo = tmdbCandidates
      .map((candidate, index) => {
        const data = candidate.data;
        const title = candidate.type === 'movie' ? data.title : data.name;
        const originalTitle = candidate.type === 'movie' ? data.originalTitle : data.originalName;
        const releaseDate = candidate.type === 'movie' ? data.releaseDate : data.firstAirDate;
        const year = releaseDate ? new Date(releaseDate).getFullYear() : 'N/A';

        return `${index + 1}. [${candidate.type.toUpperCase()}] ${title}
   원제: ${originalTitle}
   개봉연도: ${year}
   개요: ${(data.overview || '').substring(0, 100)}...
   TMDB ID: ${data.id}`;
      })
      .join('\n\n');

    return `다음 YouTube 동영상의 제목, 설명, 자막을 종합 분석해주세요:${runtimeInfo}

분석 대상 콘텐츠:
${content}

TMDB 검색 후보들:
${candidatesInfo}

요청사항:
1. 이 동영상에서 다루는 영화나 TV 프로그램의 정확한 제목을 추출해주세요 (한국어, 영어 모두)
2. 이 동영상이 해당 작품의 결말이나 스포일러를 포함하는지 판단해주세요
3. 위의 TMDB 후보들 중 가장 적합한 작품을 선택해주세요

다음 JSON 형식으로 응답해주세요:
{
  "extracted_titles": ["제목1", "제목2"],
  "includes_ending": true/false,
  "confidence": 85,
  "reasoning": "분석 근거 설명",
  "selected_tmdb": {
    "index": 1,
    "tmdb_id": 12345,
    "type": "movie",
    "confidence": 90,
    "reasoning": "선택한 이유"
  },
  "story_analysis": {
    "has_beginning": true/false,
    "has_middle": true/false,
    "has_ending": true/false,
    "story_completeness": "complete/partial/review_only"
  }
}`;
  }

  /**
   * AI 분석 응답 파싱
   */
  private parseAnalysisResponse(aiResponse: string, originalContent: string): ScriptAnalysisResult {
    try {
      const jsonMatch = aiResponse.trim().match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        const result: ScriptAnalysisResult = {
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

  /**
   * 키워드 기반 폴백 분석
   */
  private keywordAnalysis(content: string): ScriptAnalysisResult {
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
