/**
 * 애플리케이션 설정 상수
 * 매직 넘버를 명명된 상수로 정의하여 가독성과 유지보수성 향상
 */

/**
 * TMDB 검색 관련 상수
 */
export const TMDB_CONFIG = {
  /** TMDB 후보 최대 개수 */
  MAX_CANDIDATES: 5,
  /** 최소 제목 길이 */
  MIN_TITLE_LENGTH: 2,
  /** 최대 제목 길이 */
  MAX_TITLE_LENGTH: 30,
  /** 고신뢰도 매칭을 위한 최소 인기도 */
  MIN_POPULARITY_THRESHOLD: 10,
  /** 한국어 검색 결과 최대 개수 */
  SEARCH_LIMIT_KO: 5,
  /** 전체 검색 결과 최대 개수 (한국어 + 영어) */
  SEARCH_LIMIT_TOTAL: 8,
} as const;

/**
 * AI 분석 관련 상수
 */
export const AI_CONFIG = {
  /** 자막 캐시 최대 크기 */
  MAX_TRANSCRIPT_CACHE_SIZE: 10,
  /** 자막 캐시 TTL (밀리초) - 5분 */
  CACHE_TTL_MS: 5 * 60 * 1000,
} as const;

/**
 * Primary 비디오 선택 점수 가중치
 */
export const SELECTION_SCORE_WEIGHTS = {
  /** 제목 정확 일치 점수 */
  EXACT_TITLE_MATCH: 10,
  /** 제목 높은 유사도 (Dice >= 0.8) */
  HIGH_SIMILARITY_MATCH: 7,
  /** 제목 중간 유사도 (Dice >= 0.6) */
  MODERATE_SIMILARITY_MATCH: 4,
  /** 영화 이모지 보너스 점수 */
  MOVIE_EMOJI_BONUS: 5,
  /** 연도 일치 점수 */
  YEAR_MATCH: 8,
  /** 첫 번째 후보 보너스 점수 */
  FIRST_CANDIDATE_BONUS: 2,
} as const;
