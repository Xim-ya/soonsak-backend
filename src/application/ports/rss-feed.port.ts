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
 * 채널에 영상 탭이 없어서 추출이 불가능한 경우에 발생
 * 이 에러가 나면 해당 채널은 더 이상 크론 대상이 아니도록 비활성화해야 함
 */
export class NoVideosTabError extends Error {
  readonly channelId: string;

  constructor(channelId: string, message?: string) {
    super(message ?? `Channel ${channelId} has no Videos tab and no extractable long-form videos`);
    this.name = 'NoVideosTabError';
    this.channelId = channelId;
  }
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
