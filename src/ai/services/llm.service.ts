import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ExtractedContent, YouTubeVideoInfo, TMDBSearchResult } from '@/common/types';
import { AIException } from '@/common/exceptions';

/**
 * LLM 서비스
 * OpenAI를 사용한 콘텐츠 추출 처리
 */
@Injectable()
export class LLMService implements OnModuleInit {
  private readonly logger = new Logger(LLMService.name);
  private openai: OpenAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(private readonly configService: ConfigService) {
    this.openai = null as unknown as OpenAI;
    this.model = '';
    this.maxTokens = 0;
    this.temperature = 0;
  }

  onModuleInit() {
    const apiKey = this.configService.getOrThrow<string>('OPENAI_API_KEY');
    this.openai = new OpenAI({ apiKey });
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
    this.maxTokens = this.configService.get<number>('OPENAI_MAX_TOKENS', 1000);
    this.temperature = this.configService.get<number>('OPENAI_TEMPERATURE', 0.1);
    this.logger.log(`LLM Service initialized with model: ${this.model}`);
  }

  /**
   * 모델에 따른 요청 파라미터 조회
   */
  private getRequestParams(maxTokens?: number) {
    const tokens = maxTokens || this.maxTokens;

    if (this.model.includes('o3-mini')) {
      return {
        model: this.model,
        max_completion_tokens: tokens,
      };
    }

    return {
      model: this.model,
      max_tokens: tokens,
      temperature: this.temperature,
    };
  }

  /**
   * YouTube 비디오 정보에서 영화/TV 정보 추출
   */
  async extractContentInfo(videoInfo: YouTubeVideoInfo): Promise<ExtractedContent | null> {
    try {
      let processedTranscript = videoInfo.transcript;
      if (processedTranscript && processedTranscript.length > 2000) {
        processedTranscript = await this.summarizeText(processedTranscript);
      }

      const prompt = this.getExtractionPrompt(videoInfo.title, videoInfo.description, processedTranscript);

      const response = await this.openai.chat.completions.create({
        ...this.getRequestParams(),
        messages: [
          {
            role: 'system',
            content:
              '당신은 YouTube 콘텐츠에서 영화/TV 정보를 정확히 추출하는 전문가입니다. 정확한 정보만 제공하고, 불확실하면 null을 반환하세요.',
          },
          { role: 'user', content: prompt },
        ],
      });

      const responseContent = response.choices[0]?.message?.content?.trim();
      if (!responseContent) return null;

      return this.parseExtractionResponse(responseContent);
    } catch (error) {
      throw AIException.extractionFailed(error as Error);
    }
  }

  /**
   * 긴 텍스트 요약
   */
  async summarizeText(text: string): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        ...this.getRequestParams(500),
        messages: [
          {
            role: 'user',
            content: `다음 YouTube 비디오의 스크립트나 설명을 간단히 요약해주세요. 영화나 TV 프로그램과 관련된 내용이 있다면 특히 강조해주세요:\n\n${text}\n\n요약:`,
          },
        ],
      });

      return response.choices[0]?.message?.content?.trim() || text.substring(0, 1000);
    } catch {
      this.logger.warn('Text summarization failed, using truncated text');
      return text.substring(0, 1000);
    }
  }

  /**
   * 추출 프롬프트 구성
   */
  private getExtractionPrompt(title: string, description: string, transcript?: string): string {
    return `당신은 YouTube 콘텐츠 분석 전문가입니다. 주어진 정보를 바탕으로 이 YouTube 비디오가 다루는 영화나 TV 프로그램을 식별해주세요.

제목: "${title}"
설명: "${description}"
${transcript ? `스크립트: "${transcript}"` : ''}

다음 조건을 만족하는 JSON 형태로만 응답해주세요:
1. 영화나 TV 프로그램이 명확히 식별되는 경우만 응답
2. 불확실하거나 관련 없는 콘텐츠면 null 반환
3. 한국 제목과 영어 제목 모두 제공
4. 개봉/방영 연도 추정

**반드시 다음 JSON 형식으로만 응답하세요:**

{
  "type": "movie",
  "title_ko": "한국어 제목",
  "title_en": "영어 제목",
  "release_year": "YYYY",
  "confidence": 0.95
}

또는 확실하지 않으면:

null

JSON 외의 다른 텍스트는 절대 포함하지 마세요.`;
  }

  /**
   * 추출 응답 파싱
   */
  private parseExtractionResponse(response: string): ExtractedContent | null {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        if (parsed === null || !parsed.type || !parsed.title_ko || !parsed.title_en) {
          return null;
        }

        if (parsed.confidence && parsed.confidence < 0.5) {
          return null;
        }

        return {
          type: parsed.type,
          titleKo: parsed.title_ko,
          titleEn: parsed.title_en,
          releaseYear: parsed.release_year || undefined,
          confidence: parsed.confidence || 0.8,
        };
      }

      if (response.toLowerCase().includes('null')) {
        return null;
      }
    } catch {
      this.logger.warn('Failed to parse LLM extraction response');
    }

    return null;
  }

  /**
   * LLM을 사용하여 TMDB 결과 순위 매기기
   */
  async rankTMDBResults(extractedContent: ExtractedContent, tmdbResults: TMDBSearchResult[]): Promise<number> {
    if (tmdbResults.length <= 1) return 0;

    try {
      const resultsText = tmdbResults
        .map((result, index) => {
          const title = result.title || result.name;
          const originalTitle = result.originalTitle || result.originalName;
          const date = result.releaseDate || result.firstAirDate;
          return `${index}. 제목: ${title}, 원제: ${originalTitle}, 날짜: ${date}`;
        })
        .join('\n');

      const prompt = `다음은 TMDB 검색 결과들입니다. 추출된 콘텐츠 정보와 가장 일치하는 항목의 번호만 반환하세요.

추출된 정보:
- 타입: ${extractedContent.type}
- 한국어 제목: ${extractedContent.titleKo}
- 영어 제목: ${extractedContent.titleEn}
- 연도: ${extractedContent.releaseYear || '알 수 없음'}

TMDB 검색 결과:
${resultsText}

가장 일치하는 항목의 번호만 반환하세요 (0부터 시작):`;

      const response = await this.openai.chat.completions.create({
        ...this.getRequestParams(10),
        messages: [{ role: 'user', content: prompt }],
      });

      const result = response.choices[0]?.message?.content?.trim();
      const index = parseInt(result || '0');

      return isNaN(index) ? 0 : Math.min(Math.max(index, 0), tmdbResults.length - 1);
    } catch {
      this.logger.warn('TMDB ranking failed, returning first result');
      return 0;
    }
  }
}
