import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 기본 애플리케이션 예외
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    public readonly originalError?: Error,
  ) {
    super({ code, message }, status);
  }
}

/**
 * YouTube 추출 관련 예외
 */
export class YouTubeException extends AppException {
  constructor(code: string, message: string, originalError?: Error) {
    super(code, message, HttpStatus.BAD_REQUEST, originalError);
  }

  static invalidVideoId(id: string): YouTubeException {
    return new YouTubeException('INVALID_VIDEO_ID', `유효하지 않은 YouTube 비디오 ID: ${id}`);
  }

  static initFailed(error?: Error): YouTubeException {
    return new YouTubeException('YOUTUBE_INIT_FAILED', 'YouTube 클라이언트 초기화 실패', error);
  }

  static videoNotFound(videoId: string): YouTubeException {
    return new YouTubeException('VIDEO_NOT_FOUND', `비디오를 찾을 수 없음: ${videoId}`);
  }

  static fetchFailed(resource: string, error?: Error): YouTubeException {
    return new YouTubeException('FETCH_FAILED', `${resource} 조회 실패`, error);
  }

  static rssFetchFailed(status: number): YouTubeException {
    return new YouTubeException('RSS_FETCH_FAILED', `RSS 조회 실패 (상태: ${status})`);
  }

  static rssParseFailed(error?: Error): YouTubeException {
    return new YouTubeException('RSS_PARSE_FAILED', 'RSS 피드 파싱 실패', error);
  }

  static channelNotFound(channelId: string): YouTubeException {
    return new YouTubeException('CHANNEL_NOT_FOUND', `채널을 찾을 수 없음: ${channelId}`);
  }

  static contentExtractionFailed(error?: Error): YouTubeException {
    return new YouTubeException('CONTENT_EXTRACTION_FAILED', '비디오 콘텐츠 추출 실패', error);
  }

  static transcriptNotFound(videoId: string): YouTubeException {
    return new YouTubeException('TRANSCRIPT_NOT_FOUND', `자막을 찾을 수 없음: ${videoId}`);
  }
}

/**
 * TMDB 관련 예외
 */
export class TMDBException extends AppException {
  constructor(code: string, message: string, originalError?: Error) {
    super(code, message, HttpStatus.BAD_REQUEST, originalError);
  }

  static requestFailed(status: number, error?: Error): TMDBException {
    return new TMDBException('TMDB_REQUEST_FAILED', `TMDB API 요청 실패 (상태: ${status})`, error);
  }

  static searchFailed(query: string, error?: Error): TMDBException {
    return new TMDBException('TMDB_SEARCH_FAILED', `TMDB 검색 실패: ${query}`, error);
  }

  static noMatchFound(titles: string[]): TMDBException {
    return new TMDBException('TMDB_NO_MATCH', `TMDB 매칭 결과 없음: ${titles.join(', ')}`);
  }
}

/**
 * AI/LLM 관련 예외
 */
export class AIException extends AppException {
  constructor(code: string, message: string, originalError?: Error) {
    super(code, message, HttpStatus.INTERNAL_SERVER_ERROR, originalError);
  }

  static extractionFailed(error?: Error): AIException {
    return new AIException('LLM_EXTRACTION_FAILED', 'LLM 콘텐츠 추출 실패', error);
  }

  static analysisFailed(error?: Error): AIException {
    return new AIException('AI_ANALYSIS_FAILED', 'AI 분석 실패', error);
  }
}

/**
 * 데이터베이스 관련 예외
 */
export class DatabaseException extends AppException {
  constructor(code: string, message: string, originalError?: Error) {
    super(code, message, HttpStatus.INTERNAL_SERVER_ERROR, originalError);
  }

  static operationFailed(operation: string, error?: Error): DatabaseException {
    return new DatabaseException('DB_OPERATION_FAILED', `데이터베이스 작업 실패: ${operation}`, error);
  }
}
