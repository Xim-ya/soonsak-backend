import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@/database';
import { YouTubeRSSService } from '@/youtube';
import { ChannelEntity, YouTubeRSSEntry } from '@/common/types';

/**
 * 채널 서비스
 * 채널 데이터 및 RSS 피드 작업 관리
 */
@Injectable()
export class ChannelService {
  private readonly logger = new Logger(ChannelService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly rssService: YouTubeRSSService,
  ) {}

  /**
   * 등록된 모든 채널 조회
   */
  async getAllChannels(): Promise<ChannelEntity[]> {
    try {
      return await this.databaseService.getAllChannels();
    } catch (error) {
      this.logger.error('Failed to fetch channels', error);
      return [];
    }
  }

  /**
   * ID로 채널 조회
   */
  async getChannelById(channelId: string): Promise<ChannelEntity | null> {
    const channels = await this.getAllChannels();
    return channels.find((c) => c.id === channelId) || null;
  }

  /**
   * 채널 RSS 피드에서 최근 비디오 조회
   */
  async getRecentVideos(channelId: string, maxResults = 15): Promise<YouTubeRSSEntry[]> {
    try {
      return await this.rssService.getRecentVideos(channelId, maxResults);
    } catch (error) {
      this.logger.error(`Failed to fetch RSS for channel ${channelId}`, error);
      return [];
    }
  }

  /**
   * 채널의 이미 처리된 비디오 ID 조회
   */
  async getProcessedVideoIds(channelId: string): Promise<string[]> {
    try {
      return await this.databaseService.getRecentVideoIds(channelId, 100);
    } catch (error) {
      this.logger.error(`Failed to fetch processed videos for channel ${channelId}`, error);
      return [];
    }
  }

  /**
   * Filter new videos that haven't been processed
   */
  async filterNewVideos(channelId: string, videos: YouTubeRSSEntry[]): Promise<YouTubeRSSEntry[]> {
    const processedIds = await this.getProcessedVideoIds(channelId);
    const processedSet = new Set(processedIds);

    return videos.filter((video) => !processedSet.has(video.videoId));
  }
}
