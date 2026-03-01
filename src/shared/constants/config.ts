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
  /** AI 추론 연도 일치 점수 (동명 영화 구분용) */
  AI_YEAR_MATCH: 12,
  /** AI 추론 연도 근접 (±1년) */
  AI_YEAR_CLOSE: 6,
  /** AI 추론 연도 불일치 페널티 (5년 초과 차이) */
  AI_YEAR_MISMATCH_PENALTY: -15,
  /** AI 추론 연도 대형 불일치 페널티 (10년 초과 차이) */
  AI_YEAR_MAJOR_MISMATCH_PENALTY: -30,
  /** AI 추론 장르 일치 점수 (장르당) */
  AI_GENRE_MATCH: 5,
  /** AI 추론 장르 2개 이상 일치 보너스 */
  AI_GENRE_MULTI_MATCH_BONUS: 3,
  /** 미디어 타입 불일치 페널티 (YouTube 제목이 "드라마"인데 영화로 매칭 등) */
  MEDIA_TYPE_MISMATCH_PENALTY: -20,
  /** 미디어 타입 일치 보너스 (Phase 1 mediaType 힌트와 일치) */
  MEDIA_TYPE_MATCH_BONUS: 5,
  /** 첫 번째 후보 보너스 점수 */
  FIRST_CANDIDATE_BONUS: 2,
  /** 매칭 수락을 위한 최소 점수 (이 점수 미만이면 매칭 실패 처리) */
  MIN_MATCH_SCORE: 4,
  /** 인기도 높음 보너스 (popularity >= 10) */
  HIGH_POPULARITY_BONUS: 8,
  /** 인기도 중간 보너스 (popularity >= 1) */
  MODERATE_POPULARITY_BONUS: 4,
  /** 인기도 매우 낮음 페널티 (popularity < 0.5) */
  LOW_POPULARITY_PENALTY: -10,
  /** 오래된 콘텐츠 페널티 (50년 이상) */
  OLD_CONTENT_PENALTY: -25,
  /** 매우 오래된 콘텐츠 페널티 (80년 이상) */
  VERY_OLD_CONTENT_PENALTY: -40,
} as const;

/**
 * TMDB 장르 ID -> 한국어 매핑 (AI 추론 장르 비교용)
 */
export const TMDB_GENRE_MAP: Record<number, string> = {
  28: '액션',
  12: '모험',
  16: '애니메이션',
  35: '코미디',
  80: '범죄',
  99: '다큐멘터리',
  18: '드라마',
  10751: '가족',
  14: '판타지',
  36: '역사',
  27: '공포',
  10402: '음악',
  9648: '미스터리',
  10749: '로맨스',
  878: 'SF',
  10770: 'TV 영화',
  53: '스릴러',
  10752: '전쟁',
  37: '서부',
  // TV 전용 장르
  10759: '액션',
  10762: '키즈',
  10763: '뉴스',
  10764: '리얼리티',
  10765: 'SF',
  10766: '드라마',
  10767: '토크',
  10768: '전쟁',
};

/**
 * 한국어 장르 -> TMDB 장르 ID 역방향 매핑 (Discover API용)
 */
export const TMDB_GENRE_REVERSE_MAP: Record<string, number> = {
  '액션': 28,
  '모험': 12,
  '애니메이션': 16,
  '코미디': 35,
  '범죄': 80,
  '다큐멘터리': 99,
  '드라마': 18,
  '가족': 10751,
  '판타지': 14,
  '역사': 36,
  '공포': 27,
  '호러': 27,
  '음악': 10402,
  '미스터리': 9648,
  '로맨스': 10749,
  'SF': 878,
  '스릴러': 53,
  '전쟁': 10752,
  '서부': 37,
};
