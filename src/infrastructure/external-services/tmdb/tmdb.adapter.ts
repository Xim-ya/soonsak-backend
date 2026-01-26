import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IContentSearchPort,
  ContentSearchResult,
  ContentMatchResult,
} from '@/application/ports';

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

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`TMDB request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  }

  async searchMulti(query: string): Promise<ContentMatchResult[]> {
    const candidates: ContentMatchResult[] = [];

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

  async searchMovies(query: string, year?: string): Promise<ContentSearchResult[]> {
    const params: Record<string, string> = {
      query,
      region: this.region,
    };

    if (year) {
      params.year = year;
      params.primary_release_year = year;
    }

    const response = await this.makeRequest<{ results: any[] }>(
      '/search/movie',
      params,
    );

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

  async searchTV(query: string, year?: string): Promise<ContentSearchResult[]> {
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

  private mapSearchResult(result: any): ContentSearchResult {
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
}
