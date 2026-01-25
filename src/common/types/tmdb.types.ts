/**
 * 콘텐츠 타입 (영화/TV)
 */
export type ContentType = 'movie' | 'tv';

/**
 * TMDB 검색 결과
 */
export interface TMDBSearchResult {
  id: number;
  title?: string;
  name?: string;
  originalTitle?: string;
  originalName?: string;
  releaseDate?: string;
  firstAirDate?: string;
  overview: string;
  posterPath?: string;
  backdropPath?: string;
  popularity: number;
  voteAverage: number;
  voteCount: number;
  mediaType: ContentType;
}

/**
 * TMDB 매칭 결과 (신뢰도 점수 포함)
 */
export interface TMDBMatchResult {
  type: ContentType;
  data: TMDBSearchResult;
  confidence?: number;
  searchTerm?: string;
}
