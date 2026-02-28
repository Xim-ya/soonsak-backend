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
 * Discover API 파라미터
 */
export interface DiscoverParams {
  /** 장르 ID 목록 (OR 조건) */
  genreIds?: number[];
  /** 개봉 연도 */
  year?: number;
  /** 개봉 연도 범위 (시작) */
  yearFrom?: number;
  /** 개봉 연도 범위 (끝) */
  yearTo?: number;
  /** 키워드 (콤마 구분) */
  keywords?: string;
  /** 정렬 기준 */
  sortBy?: 'popularity.desc' | 'release_date.desc' | 'vote_average.desc';
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
   * Discover API로 영화 검색 (장르 + 연도 기반)
   */
  discoverMovies(params: DiscoverParams): Promise<ContentMatchResult[]>;

  /**
   * Discover API로 TV 검색 (장르 + 연도 기반)
   */
  discoverTV(params: DiscoverParams): Promise<ContentMatchResult[]>;

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
