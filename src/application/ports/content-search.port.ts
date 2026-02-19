import { ContentTypeValue, LogoLanguage } from '@/domain/value-objects';

/**
 * TMDB 검색 결과
 */
export interface ContentSearchResult {
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
  genreIds?: number[];
  originalLanguage?: string;
  mediaType: ContentTypeValue;
}

/**
 * 콘텐츠 검색 매칭 결과
 */
export interface ContentMatchResult {
  type: ContentTypeValue;
  data: ContentSearchResult;
  confidence?: number;
  searchTerm?: string;
}

/**
 * 인물 정보 (감독/배우)
 */
export interface PersonInfo {
  id: number;
  name: string;
}

/**
 * 콘텐츠 상세 정보 (Details API)
 */
export interface ContentDetails {
  id: number;
  tagline?: string;
  backdropPath?: string;
  releaseDate?: string;
  genreIds?: number[];
  overview?: string;
  // AI 분석용 추가 필드
  voteAverage?: number;
  popularity?: number;
  originCountry?: string[];
  directors?: PersonInfo[];
  mainCast?: PersonInfo[];
}

/**
 * 타이틀 로고 결과
 */
export interface TitleLogoResult {
  path: string | null;
  lang: LogoLanguage | null;
}

/**
 * 콘텐츠 검색 포트 (TMDB 추상화)
 */
export interface IContentSearchPort {
  /**
   * 멀티 검색 (영화 + TV)
   */
  searchMulti(query: string, year?: string): Promise<ContentMatchResult[]>;

  /**
   * 영화만 검색
   */
  searchMovies(query: string): Promise<ContentSearchResult[]>;

  /**
   * TV만 검색
   */
  searchTV(query: string): Promise<ContentSearchResult[]>;

  /**
   * 콘텐츠 상세 정보 조회 (tagline 등)
   */
  getDetails(id: number, type: ContentTypeValue): Promise<ContentDetails>;

  /**
   * 타이틀 로고 이미지 조회
   * 한국어 로고 우선, 없으면 영어 로고
   */
  getTitleLogo(id: number, type: ContentTypeValue): Promise<TitleLogoResult>;
}
