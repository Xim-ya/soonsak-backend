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
 * YouTube RSS 피드 항목
 */
export interface YouTubeRSSEntry {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  channelId: string;
  channelName: string;
  thumbnail: string;
  viewCount?: number;
}

/**
 * YouTube 채널 정보
 */
export interface YouTubeChannelInfo {
  id: string;
  name: string;
  handleId: string;
  logoUrl: string;
  bannerUrl: string;
  subscriberCount: number;
}
