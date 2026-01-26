import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS } from '@/shared/constants';
import { IVideoRepository, IChannelRepository } from '@/domain/repositories';
import { IRSSFeedPort } from '@/application/ports';
import { ProcessVideoUseCase } from '../process-video';
import { ProcessChannelInput, ProcessChannelResult } from './process-channel.dto';

/**
 * 채널 처리 Use Case
 * 단일 채널의 최근 비디오 처리
 */
@Injectable()
export class ProcessChannelUseCase {
  private readonly logger = new Logger(ProcessChannelUseCase.name);

  constructor(
    @Inject(INJECTION_TOKENS.CHANNEL_REPOSITORY)
    private readonly channelRepository: IChannelRepository,
    @Inject(INJECTION_TOKENS.VIDEO_REPOSITORY)
    private readonly videoRepository: IVideoRepository,
    @Inject(INJECTION_TOKENS.RSS_FEED)
    private readonly rssFeed: IRSSFeedPort,
    private readonly processVideoUseCase: ProcessVideoUseCase,
  ) {}

  async execute(input: ProcessChannelInput): Promise<ProcessChannelResult> {
    const { channelId, maxVideos = 15 } = input;
    this.logger.log(`Processing channel: ${channelId}`);

    const result: ProcessChannelResult = {
      channelId,
      channelName: '',
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    try {
      const recentVideos = await this.rssFeed.getRecentVideos(channelId, maxVideos);
      result.channelName = recentVideos[0]?.channelName || channelId;

      this.logger.log(`  Found ${recentVideos.length} recent videos`);

      const processedVideoIds = await this.getProcessedVideoIds(channelId);

      for (const rssEntry of recentVideos) {
        if (processedVideoIds.has(rssEntry.videoId)) {
          result.skippedCount++;
          continue;
        }

        result.processedCount++;

        try {
          const processResult = await this.processVideoUseCase.execute({
            videoId: rssEntry.videoId,
            title: rssEntry.title,
            description: rssEntry.description,
            publishedAt: rssEntry.publishedAt,
            updatedAt: rssEntry.updatedAt,
            channelId: rssEntry.channelId,
            channelName: rssEntry.channelName,
            thumbnail: rssEntry.thumbnail,
            viewCount: rssEntry.viewCount,
          });

          if (processResult.success) {
            result.successCount++;
          } else {
            if (processResult.message === '이미 처리된 동영상입니다') {
              result.skippedCount++;
              result.processedCount--;
            } else {
              result.failedCount++;
              result.errors.push(`${rssEntry.videoId}: ${processResult.message}`);
            }
          }
        } catch (error) {
          result.failedCount++;
          result.errors.push(`${rssEntry.videoId}: ${(error as Error).message}`);
        }
      }

      this.logger.log(
        `  Channel completed: ${result.successCount} success, ${result.failedCount} failed, ${result.skippedCount} skipped`,
      );
    } catch (error) {
      result.errors.push(`Channel error: ${(error as Error).message}`);
      this.logger.error(`  Channel processing failed: ${(error as Error).message}`);
    }

    return result;
  }

  private async getProcessedVideoIds(channelId: string): Promise<Set<string>> {
    try {
      const channel = await this.channelRepository.findById(channelId);
      if (!channel) {
        return new Set();
      }

      const videoIds = await (
        this.videoRepository as any
      ).getRecentVideoIds?.(channelId, 50);
      return new Set(videoIds || []);
    } catch {
      return new Set();
    }
  }
}
