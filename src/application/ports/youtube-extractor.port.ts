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
  likeCount?: number;
  isShorts?: boolean;
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
 * 채널 비디오 목록 항목
 */
export interface ChannelVideoItem {
  videoId: string;
  title: string;
  publishedAt: string;
  thumbnail: string;
  viewCount?: number;
}

/**
 * 채널 메타데이터
 */
export interface ChannelMetadata {
  id: string;
  name: string;
  handleId?: string;
  logoUrl?: string;
  bannerUrl?: string;
  subscriberCount?: number;
}

/**
 * 쇼츠 체크 결과
 */
export interface ShortsCheckResult {
  isShorts: boolean;
  duration: number;
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

  /**
   * 쇼츠 여부 빠른 체크 (youtubei.js 사용, rate limit 영향 적음)
   * yt-dlp 호출 전에 사용하여 불필요한 API 호출 방지
   */
  checkIfShorts(videoId: string): Promise<ShortsCheckResult>;

  /**
   * 채널의 모든 비디오 목록 조회
   */
  getChannelVideos(channelId: string, maxResults?: number): Promise<ChannelVideoItem[]>;

  /**
   * 채널 메타데이터 조회
   */
  getChannelMetadata(channelId: string): Promise<ChannelMetadata>;
}
