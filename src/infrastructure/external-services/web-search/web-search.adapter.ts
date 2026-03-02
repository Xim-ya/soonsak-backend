import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IWebSearchPort,
  WebSearchResult,
  ExtractedMovieTitle,
} from '@/application/ports';
import { retryWithBackoff } from '@/shared/utils/async.util';

/**
 * Serper API 응답 타입
 */
interface SerperSearchResult {
  title: string;
  link: string;
  snippet: string;
}

interface SerperResponse {
  organic?: SerperSearchResult[];
}

/**
 * 웹 검색 어댑터 (Serper API 사용)
 *
 * 환경변수:
 * - SERPER_API_KEY: Serper API 키 (https://serper.dev)
 */
@Injectable()
export class WebSearchAdapter implements IWebSearchPort {
  private readonly logger = new Logger(WebSearchAdapter.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://google.serper.dev/search';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('SERPER_API_KEY', '');
    if (!this.apiKey) {
      this.logger.warn('SERPER_API_KEY not configured - web search will be disabled');
    }
  }

  /**
   * 웹 검색 수행
   */
  async search(
    query: string,
    options?: { limit?: number },
  ): Promise<WebSearchResult> {
    if (!this.apiKey) {
      return { query, items: [] };
    }

    const limit = options?.limit || 5;

    try {
      const response = await retryWithBackoff(
        async () => {
          const res = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
              'X-API-KEY': this.apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              q: query,
              num: limit,
            }),
          });

          if (!res.ok) {
            throw new Error(`Serper API error: ${res.status}`);
          }

          return res.json() as Promise<SerperResponse>;
        },
        { maxRetries: 2, baseDelay: 500 },
      );

      const items = (response.organic || []).map((item) => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet,
      }));

      this.logger.log(`Web search: "${query}" → ${items.length} results`);
      return { query, items };
    } catch (error) {
      this.logger.warn(`Web search failed: ${(error as Error).message}`);
      return { query, items: [] };
    }
  }

  /**
   * 웹 검색으로 영화 제목 추출
   * 검색 결과에서 영화 제목과 연도를 추출
   */
  async searchAndExtractMovieTitles(
    queries: string[],
  ): Promise<ExtractedMovieTitle[]> {
    if (!this.apiKey || queries.length === 0) {
      return [];
    }

    const extractedTitles: ExtractedMovieTitle[] = [];
    const seenTitles = new Set<string>();

    // 각 검색어로 검색 수행 (최대 3개)
    const limitedQueries = queries.slice(0, 3);

    for (const query of limitedQueries) {
      const result = await this.search(query, { limit: 5 });

      for (const item of result.items) {
        const extracted = this.extractTitleFromSearchResult(item.title, item.snippet);
        if (extracted && !seenTitles.has(extracted.title.toLowerCase())) {
          seenTitles.add(extracted.title.toLowerCase());
          extractedTitles.push(extracted);
        }
      }
    }

    // 신뢰도 순으로 정렬
    extractedTitles.sort((a, b) => b.confidence - a.confidence);

    this.logger.log(`Extracted ${extractedTitles.length} movie titles from web search`);
    return extractedTitles.slice(0, 5); // 최대 5개
  }

  /**
   * 검색 결과에서 영화 제목 추출
   */
  private extractTitleFromSearchResult(
    title: string,
    snippet: string,
  ): ExtractedMovieTitle | null {
    // TMDB, IMDb, Letterboxd, Wikipedia 등의 영화 페이지 패턴
    const moviePagePatterns = [
      // TMDB: "Savage Hunt (2025) — The Movie Database"
      /^(.+?)\s*\((\d{4})\)\s*[—–-]\s*(?:The Movie Database|TMDB)/i,
      // IMDb: "Savage Hunt (2025) - IMDb"
      /^(.+?)\s*\((\d{4})\)\s*[—–-]\s*IMDb/i,
      // Letterboxd: "Savage Hunt (2025) - Letterboxd"
      /^(.+?)\s*\((\d{4})\)\s*[—–-]\s*Letterboxd/i,
      // Wikipedia: "Savage Hunt (film) - Wikipedia"
      /^(.+?)\s*\((?:film|movie|영화)\)\s*[—–-]\s*Wikipedia/i,
      // 일반 패턴: "영화 제목 (2025)"
      /^(.+?)\s*\((\d{4})\)/,
      // 나무위키: "세비지 헌트 - 나무위키"
      /^(.+?)\s*[—–-]\s*나무위키/i,
    ];

    // 따옴표 안의 제목 추출 패턴 (스니펫/제목에서)
    const quotedTitlePatterns = [
      // 'Title' (Year) 또는 "Title" (Year)
      /['"]([A-Za-z][A-Za-z\s:]+(?:\s+[A-Za-z]+)*)['"]\s*\((\d{4})\)/i,
      // 'Title' 또는 "Title" (연도 없음)
      /['"]([A-Za-z][A-Za-z\s:]+(?:\s+[A-Za-z]+)*)['"]/i,
      // 한글: '제목' (연도)
      /['"]([가-힣][가-힣\s]+)['"]\s*\((\d{4})\)/,
      // 한글 작은따옴표: '낮과 밤' (연도 없음, 뉴스 기사 형식)
      /['']([가-힣][가-힣\s]{1,15})[''][,\s]/,
      // 한글 큰따옴표: "제목" (연도 없음)
      /[""]([가-힣][가-힣\s]{1,15})[""][,\s]/,
    ];

    let confidence = 50;
    let extractedTitle: string | null = null;
    let year: number | undefined;
    let englishTitle: string | undefined;

    // 제목에서 추출 시도
    for (const pattern of moviePagePatterns) {
      const match = title.match(pattern);
      if (match) {
        extractedTitle = match[1].trim();
        if (match[2]) {
          year = parseInt(match[2], 10);
        }
        // TMDB, IMDb 등 신뢰할 수 있는 소스면 높은 신뢰도
        if (/TMDB|IMDb|Letterboxd/i.test(title)) {
          confidence = 90;
        } else if (/Wikipedia|나무위키/i.test(title)) {
          confidence = 80;
        } else {
          confidence = 70;
        }
        break;
      }
    }

    // 기본 패턴 실패 시 따옴표 패턴 시도 (제목 + 스니펫)
    if (!extractedTitle) {
      const combinedText = `${title} ${snippet}`;
      for (const pattern of quotedTitlePatterns) {
        const match = combinedText.match(pattern);
        if (match) {
          const candidate = match[1].trim();
          // 영화 제목으로 적합한지 검증 (2단어 이상, 적절한 길이)
          if (candidate.length >= 3 && candidate.length <= 50) {
            extractedTitle = candidate;
            if (match[2]) {
              year = parseInt(match[2], 10);
            }
            confidence = 60; // 따옴표 패턴은 중간 신뢰도
            break;
          }
        }
      }
    }

    if (!extractedTitle) {
      return null;
    }

    // 영어 제목 추출 (한글 제목인 경우 스니펫에서 영어 제목 찾기)
    if (/[가-힣]/.test(extractedTitle)) {
      // 스니펫에서 영어 제목 패턴 찾기
      const englishMatch = snippet.match(/(?:원제|English|Original)[:\s]*([A-Za-z][A-Za-z\s]+)/i);
      if (englishMatch) {
        englishTitle = englishMatch[1].trim();
      }
    } else {
      // 영어 제목인 경우 그대로 사용
      englishTitle = extractedTitle;
    }

    return {
      title: extractedTitle,
      englishTitle,
      year,
      confidence,
    };
  }
}
