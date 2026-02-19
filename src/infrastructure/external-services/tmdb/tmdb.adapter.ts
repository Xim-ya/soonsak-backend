import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IContentSearchPort,
  ContentSearchResult,
  ContentMatchResult,
  ContentDetails,
  TitleLogoResult,
} from '@/application/ports';
import { ContentTypeValue, LogoLanguage } from '@/domain/value-objects';
import { TMDB_CONFIG } from '@/shared/constants';
import { retryWithBackoff } from '@/shared/utils/async.util';

/**
 * TMDB API 응답 타입
 */
interface TMDBSearchResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

/**
 * TMDB Multi Search 결과 항목 (모든 타입 포함)
 */
interface TMDBMultiSearchResultItem {
  id: number;
  media_type: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  original_language?: string;
}

/**
 * TMDB Content 결과 항목 (movie 또는 tv만 - person 제외)
 */
interface TMDBContentResultItem extends Omit<TMDBMultiSearchResultItem, 'media_type'> {
  media_type: 'movie' | 'tv';
}

/**
 * TMDB Movie 검색 결과 항목
 */
interface TMDBMovieResultItem {
  id: number;
  title: string;
  original_title: string;
  release_date?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  original_language?: string;
}

/**
 * TMDB TV 검색 결과 항목
 */
interface TMDBTVResultItem {
  id: number;
  name: string;
  original_name: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  original_language?: string;
}

/**
 * TMDB Genre 타입
 */
interface TMDBGenre {
  id: number;
  name: string;
}

/**
 * TMDB Credits Cast/Crew 타입
 */
interface TMDBCastMember {
  id: number;
  name: string;
  character?: string;
  order?: number;
}

interface TMDBCrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
}

interface TMDBCredits {
  cast?: TMDBCastMember[];
  crew?: TMDBCrewMember[];
}

/**
 * TMDB 로고 이미지 항목
 */
interface TMDBLogoItem {
  file_path: string;
  iso_639_1: string | null;
  aspect_ratio: number;
  vote_average: number;
  vote_count: number;
  width: number;
  height: number;
}

/**
 * TMDB Images API 응답
 */
interface TMDBImagesResponse {
  id: number;
  logos?: TMDBLogoItem[];
}

/**
 * TMDB 상세 정보 응답 (Movie/TV 공통 필드)
 */
interface TMDBDetailsResponse {
  id: number;
  tagline?: string;
  backdrop_path?: string;
  release_date?: string;
  first_air_date?: string;
  genres?: TMDBGenre[];
  overview?: string;
  vote_average?: number;
  popularity?: number;
  origin_country?: string[];
  production_countries?: Array<{ iso_3166_1: string; name: string }>;
  credits?: TMDBCredits;
}

/**
 * TMDB 어댑터
 * TMDB API를 통한 영화/TV 검색
 */
@Injectable()
export class TMDBAdapter implements IContentSearchPort, OnModuleInit {
  private readonly logger = new Logger(TMDBAdapter.name);
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
    const apiKey = this.configService.get<string>('TMDB_API_KEY');
    if (apiKey) {
      this.apiKey = apiKey;
      this.logger.log('TMDBAdapter initialized');
    } else {
      this.logger.warn('TMDB_API_KEY not configured - content search will fail');
    }
  }

  private async makeRequest<T>(
    endpoint: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error('TMDB API key not configured');
    }
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('language', this.language);

    Object.entries(params).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });

    return retryWithBackoff(
      async () => {
        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`TMDB request failed with status ${response.status}`);
        }
        return (await response.json()) as T;
      },
      { maxRetries: 3, baseDelay: 500 },
    );
  }

  async searchMulti(query: string, year?: string): Promise<ContentMatchResult[]> {
    const candidates: ContentMatchResult[] = [];

    const params: Record<string, string> = {
      query,
      include_adult: 'false',
      page: '1',
    };
    if (year) {
      params.year = year;
    }

    const response = await this.makeRequest<TMDBSearchResponse<TMDBMultiSearchResultItem>>(
      '/search/multi',
      params,
    );

    if (response.results?.length > 0) {
      for (const result of response.results) {
        if (candidates.length >= TMDB_CONFIG.SEARCH_LIMIT_KO) break;
        if (this.isContentResult(result)) {
          candidates.push({
            type: result.media_type,
            data: this.mapSearchResult(result),
          });
        }
      }
    }

    if (candidates.length < TMDB_CONFIG.SEARCH_LIMIT_KO) {
      const enResponse = await this.makeRequest<TMDBSearchResponse<TMDBMultiSearchResultItem>>(
        '/search/multi',
        {
          query,
          include_adult: 'false',
          language: 'en-US',
          page: '1',
        },
      );

      if (enResponse.results?.length > 0) {
        for (const result of enResponse.results) {
          if (candidates.length >= TMDB_CONFIG.SEARCH_LIMIT_TOTAL) break;
          if (this.isContentResult(result)) {
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

  async searchMovies(query: string, year?: string): Promise<ContentSearchResult[]> {
    const params: Record<string, string> = {
      query,
      region: this.region,
    };

    if (year) {
      params.year = year;
      params.primary_release_year = year;
    }

    const response = await this.makeRequest<TMDBSearchResponse<TMDBMovieResultItem>>(
      '/search/movie',
      params,
    );

    return response.results.map((movie) => ({
      id: movie.id,
      title: movie.title,
      originalTitle: movie.original_title,
      releaseDate: movie.release_date,
      overview: movie.overview || '',
      posterPath: movie.poster_path,
      backdropPath: movie.backdrop_path,
      popularity: movie.popularity || 0,
      voteAverage: movie.vote_average || 0,
      voteCount: movie.vote_count || 0,
      genreIds: movie.genre_ids,
      originalLanguage: movie.original_language,
      mediaType: 'movie' as const,
    }));
  }

  async searchTV(query: string, year?: string): Promise<ContentSearchResult[]> {
    const params: Record<string, string> = { query };

    if (year) {
      params.first_air_date_year = year;
    }

    const response = await this.makeRequest<TMDBSearchResponse<TMDBTVResultItem>>(
      '/search/tv',
      params,
    );

    return response.results.map((tv) => ({
      id: tv.id,
      name: tv.name,
      originalName: tv.original_name,
      firstAirDate: tv.first_air_date,
      overview: tv.overview || '',
      posterPath: tv.poster_path,
      backdropPath: tv.backdrop_path,
      popularity: tv.popularity || 0,
      voteAverage: tv.vote_average || 0,
      voteCount: tv.vote_count || 0,
      genreIds: tv.genre_ids,
      originalLanguage: tv.original_language,
      mediaType: 'tv' as const,
    }));
  }

  async getDetails(id: number, type: ContentTypeValue): Promise<ContentDetails> {
    const endpoint = type === 'movie' ? `/movie/${id}` : `/tv/${id}`;
    const response = await this.makeRequest<TMDBDetailsResponse>(endpoint, {
      append_to_response: 'credits',
    });

    const releaseDate = type === 'movie' ? response.release_date : response.first_air_date;
    const genreIds = response.genres?.map((g) => g.id);

    // 제작 국가 추출 (TV는 origin_country, Movie는 production_countries)
    const originCountry = response.origin_country
      || response.production_countries?.map((c) => c.iso_3166_1)
      || [];

    // 감독 추출 (Directing department, Director job) - ID 포함
    const directors = response.credits?.crew
      ?.filter((c) => c.job === 'Director')
      .slice(0, 3)
      .map((c) => ({ id: c.id, name: c.name })) || [];

    // 주요 출연진 추출 (order 기준 상위 5명) - ID 포함
    const mainCast = response.credits?.cast
      ?.sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .slice(0, 5)
      .map((c) => ({ id: c.id, name: c.name })) || [];

    return {
      id: response.id,
      tagline: response.tagline,
      backdropPath: response.backdrop_path,
      releaseDate,
      genreIds,
      overview: response.overview,
      voteAverage: response.vote_average,
      popularity: response.popularity,
      originCountry,
      directors,
      mainCast,
    };
  }

  /**
   * 타이틀 로고 이미지 조회
   * 한국어 로고 우선, 없으면 영어 로고, 둘 다 없으면 null
   */
  async getTitleLogo(id: number, type: ContentTypeValue): Promise<TitleLogoResult> {
    const endpoint = type === 'movie' ? `/movie/${id}/images` : `/tv/${id}/images`;

    try {
      // 언어 파라미터 없이 호출하면 모든 언어의 이미지를 반환
      const response = await this.makeRequest<TMDBImagesResponse>(endpoint, {
        include_image_language: 'ko,en,null',
      });

      const logos = response.logos || [];

      if (logos.length === 0) {
        return { path: null, lang: null };
      }

      // 한국어 로고 찾기 (vote_average 높은 순)
      const koLogo = logos
        .filter((logo) => logo.iso_639_1 === 'ko')
        .sort((a, b) => b.vote_average - a.vote_average)[0];

      if (koLogo) {
        return { path: koLogo.file_path, lang: LogoLanguage.KO };
      }

      // 영어 로고 찾기 (vote_average 높은 순)
      const enLogo = logos
        .filter((logo) => logo.iso_639_1 === 'en')
        .sort((a, b) => b.vote_average - a.vote_average)[0];

      if (enLogo) {
        return { path: enLogo.file_path, lang: LogoLanguage.EN };
      }

      // 언어 없는 로고 (null) 찾기 → 기본값 EN으로 폴백
      const nullLogo = logos
        .filter((logo) => logo.iso_639_1 === null)
        .sort((a, b) => b.vote_average - a.vote_average)[0];

      if (nullLogo) {
        return { path: nullLogo.file_path, lang: LogoLanguage.EN };
      }

      return { path: null, lang: null };
    } catch (error) {
      this.logger.warn(`Failed to fetch title logo for ${type}/${id}: ${error}`);
      return { path: null, lang: null };
    }
  }

  /**
   * 타입 가드: movie 또는 tv 타입인지 확인
   */
  private isContentResult(result: TMDBMultiSearchResultItem): result is TMDBContentResultItem {
    return result.media_type === 'movie' || result.media_type === 'tv';
  }

  private mapSearchResult(result: TMDBContentResultItem): ContentSearchResult {
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
      genreIds: result.genre_ids,
      originalLanguage: result.original_language,
      mediaType: result.media_type,
    };
  }
}
