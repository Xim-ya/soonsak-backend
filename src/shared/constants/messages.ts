/**
 * 에러 및 결과 메시지 상수
 * 애플리케이션 전반에서 사용되는 메시지 문자열 중앙 관리
 */

export const MESSAGES = {
  // 비디오 처리 관련
  VIDEO: {
    ALREADY_PROCESSED: '이미 처리된 동영상입니다',
    PROCESSING_COMPLETE: '동영상 처리 완료',
    PROCESSING_FAILED: '처리 실패',
  },

  // TMDB 관련
  TMDB: {
    MATCH_FAILED_NO_RESULTS: 'TMDB 매칭 실패 - 검색결과 없음',
  },

  // 클라이언트 초기화 관련
  CLIENT: {
    SUPABASE_NOT_INITIALIZED: 'Supabase client not initialized - check SUPABASE_URL and SUPABASE_SERVICE_KEY',
  },
} as const;
