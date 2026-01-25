import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TMDBSearchResult, TMDBMatchResult, ExtractedContent } from '@/common/types';
import { TMDBException } from '@/common/exceptions';
import { compareTwoStrings } from '@/common/utils';

/**
 * TMDB 서비스
 * 영화 및 TV 프로그램 검색 및 매칭 처리
 */
@Injectable()
export class TMDBService implements OnModuleInit {
  private readonly logger = new Logger(TMDBService.name);
  private readonly baseUrl = 'https://api.themoviedb.org/3';
  private apiKey: string;
  private language: string;
  private region: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = '';
    this.language = this.configService.get<string>('TMDB_LANGUAGE', 'ko-KR');
    this.region = this.configService.get<string>('TMDB_REGION', 'KR');
  }

  onModuleInit() {
    this.apiKey = this.configService.getOrThrow<string>('TMDB_API_KEY');
    this.logger.log('TMDB Service initialized');
  }

  /**
   * TMDB API 요청 수행
   */
  private async makeRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('language', this.language);

    Object.entries(params).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });

    try {
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw TMDBException.requestFailed(response.status);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof TMDBException) throw error;
      throw TMDBException.requestFailed(500, error as Error);
    }
  }

  /**
   * 영화 검색
   */
  async searchMovies(query: string, year?: string): Promise<TMDBSearchResult[]> {
    const params: Record<string, string> = {
      query,
      region: this.region,
    };

    if (year) {
      params.year = year;
      params.primary_release_year = year;
    }

    const response = await this.makeRequest<{ results: any[] }>('/search/movie', params);

    return response.results.map((movie) => ({
      id: movie.id,
      title: movie.title,
      originalTitle: movie.original_title,
      releaseDate: movie.release_date,
      overview: movie.overview,
      posterPath: movie.poster_path,
      backdropPath: movie.backdrop_path,
      popularity: movie.popularity,
      voteAverage: movie.vote_average,
      voteCount: movie.vote_count,
      mediaType: 'movie' as const,
    }));
  }

  /**
   * TV 프로그램 검색
   */
  async searchTV(query: string, year?: string): Promise<TMDBSearchResult[]> {
    const params: Record<string, string> = { query };

    if (year) {
      params.first_air_date_year = year;
    }

    const response = await this.makeRequest<{ results: any[] }>('/search/tv', params);

    return response.results.map((tv) => ({
      id: tv.id,
      name: tv.name,
      originalName: tv.original_name,
      firstAirDate: tv.first_air_date,
      overview: tv.overview,
      posterPath: tv.poster_path,
      backdropPath: tv.backdrop_path,
      popularity: tv.popularity,
      voteAverage: tv.vote_average,
      voteCount: tv.vote_count,
      mediaType: 'tv' as const,
    }));
  }

  /**
   * 통합 검색 (영화 + TV)
   */
  async searchMulti(query: string): Promise<TMDBMatchResult[]> {
    const candidates: TMDBMatchResult[] = [];

    const response = await this.makeRequest<{ results: any[] }>('/search/multi', {
      query,
      include_adult: 'false',
      page: '1',
    });

    if (response.results?.length > 0) {
      for (const result of response.results.slice(0, 3)) {
        if (result.media_type === 'movie' || result.media_type === 'tv') {
          candidates.push({
            type: result.media_type,
            data: this.mapSearchResult(result),
          });
        }
      }
    }

    if (candidates.length < 3) {
      const enResponse = await this.makeRequest<{ results: any[] }>('/search/multi', {
        query,
        include_adult: 'false',
        language: 'en-US',
        page: '1',
      });

      if (enResponse.results?.length > 0) {
        for (const result of enResponse.results.slice(0, 5 - candidates.length)) {
          if (result.media_type === 'movie' || result.media_type === 'tv') {
            if (!candidates.find((c) => c.data.id === result.id)) {
              candidates.push({
                type: result.media_type,
                data: this.mapSearchResult(result),
              });
            }
          }
        }
      }
    }

    return candidates;
  }

  /**
   * API 결과를 TMDBSearchResult로 매핑
   */
  private mapSearchResult(result: any): TMDBSearchResult {
    const isMovie = result.media_type === 'movie';
    return {
      id: result.id,
      title: isMovie ? result.title : undefined,
      name: !isMovie ? result.name : undefined,
      originalTitle: isMovie ? result.original_title : undefined,
      originalName: !isMovie ? result.original_name : undefined,
      releaseDate: isMovie ? result.release_date : undefined,
      firstAirDate: !isMovie ? result.first_air_date : undefined,
      overview: result.overview || '',
      posterPath: result.poster_path,
      backdropPath: result.backdrop_path,
      popularity: result.popularity || 0,
      voteAverage: result.vote_average || 0,
      voteCount: result.vote_count || 0,
      mediaType: result.media_type,
    };
  }

  /**
   * 추출된 콘텐츠 기반 검색
   */
  async search(extractedContent: ExtractedContent): Promise<TMDBSearchResult[]> {
    const { type, titleKo, titleEn, releaseYear } = extractedContent;

    const searchQueries = [
      titleKo,
      titleEn,
      titleKo.replace(/[^\w\s가-힣]/g, '').trim(),
      titleEn.replace(/[^\w\s]/g, '').trim(),
    ].filter((q) => q.length > 0);

    const allResults: TMDBSearchResult[] = [];

    for (const query of searchQueries) {
      try {
        if (type === 'movie') {
          const results = await this.searchMovies(query, releaseYear);
          allResults.push(...results);
        } else {
          const results = await this.searchTV(query, releaseYear);
          allResults.push(...results);
        }
      } catch {
        // 다음 검색어로 계속
      }
    }

    const uniqueResults = allResults.filter(
      (result, index, array) =>
        array.findIndex((r) => r.id === result.id && r.mediaType === result.mediaType) === index,
    );

    return this.rankResults(extractedContent, uniqueResults);
  }

  /**
   * 유사도 및 인기도 기준으로 검색 결과 순위 매기기
   */
  private rankResults(extractedContent: ExtractedContent, results: TMDBSearchResult[]): TMDBSearchResult[] {
    return results
      .map((result) => {
        const title = result.title || result.name || '';
        const originalTitle = result.originalTitle || result.originalName || '';

        const titleSimilarity = Math.max(
          compareTwoStrings(extractedContent.titleKo.toLowerCase(), title.toLowerCase()),
          compareTwoStrings(extractedContent.titleEn.toLowerCase(), title.toLowerCase()),
          compareTwoStrings(extractedContent.titleKo.toLowerCase(), originalTitle.toLowerCase()),
          compareTwoStrings(extractedContent.titleEn.toLowerCase(), originalTitle.toLowerCase()),
        );

        let yearBonus = 0;
        if (extractedContent.releaseYear) {
          const resultYear = result.releaseDate || result.firstAirDate || '';
          if (resultYear.startsWith(extractedContent.releaseYear)) {
            yearBonus = 0.2;
          }
        }

        const popularityScore = Math.min(result.popularity / 100, 1);
        const score = titleSimilarity * 0.6 + yearBonus + popularityScore * 0.2;

        return { ...result, score };
      })
      .sort((a, b) => (b as any).score - (a as any).score)
      .map(({ score, ...result }) => result as TMDBSearchResult);
  }

  /**
   * 영화 상세 정보 조회
   */
  async getMovieDetail(movieId: number): Promise<any> {
    return this.makeRequest(`/movie/${movieId}`);
  }

  /**
   * TV 프로그램 상세 정보 조회
   */
  async getTVDetail(tvId: number): Promise<any> {
    return this.makeRequest(`/tv/${tvId}`);
  }
}
