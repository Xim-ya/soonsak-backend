/**
 * YouTube 비디오 정보
 */
export interface YouTubeVideoInfo {
  id: string;
  title: string;
  description: string;
  duration: number;
  publishedAt: string;
  channelId: string;
  channelTitle: string;
  thumbnail: string;
  transcript?: string;
  viewCount?: number;
}

/**
 * 자막 추출 결과
 */
export interface TranscriptResult {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

/**
 * YouTube 추출기 포트
 */
export interface IYouTubeExtractorPort {
  /**
   * 비디오 정보 조회
   */
  getVideoInfo(videoId: string): Promise<YouTubeVideoInfo>;

  /**
   * 자막 추출
   */
  getTranscript(videoId: string): Promise<TranscriptResult | null>;

  /**
   * 비디오 정보 + 자막 함께 조회
   */
  getVideoInfoWithTranscript(videoId: string): Promise<YouTubeVideoInfo>;
}
