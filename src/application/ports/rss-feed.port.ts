/**
 * RSS 피드 항목
 */
export interface RSSFeedEntry {
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
 * RSS 피드 포트
 */
export interface IRSSFeedPort {
  /**
   * 채널의 RSS 피드 파싱
   */
  parseChannelFeed(channelId: string): Promise<RSSFeedEntry[]>;

  /**
   * 채널의 최근 비디오 조회
   */
  getRecentVideos(channelId: string, maxResults?: number): Promise<RSSFeedEntry[]>;
}
