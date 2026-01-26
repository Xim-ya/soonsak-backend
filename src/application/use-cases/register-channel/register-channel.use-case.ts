import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS, MESSAGES } from '@/shared/constants';
import { IVideoRepository, IChannelRepository } from '@/domain/repositories';
import { IRSSFeedPort } from '@/application/ports';
import { RegisterVideoUseCase } from '../register-video';
import { RegisterChannelInput, RegisterChannelResult } from './register-channel.dto';

/**
 * 채널 등록 Use Case
 * 단일 채널의 최근 비디오 등록
 */
@Injectable()
export class RegisterChannelUseCase {
  private readonly logger = new Logger(RegisterChannelUseCase.name);

  constructor(
    @Inject(INJECTION_TOKENS.CHANNEL_REPOSITORY)
    private readonly channelRepository: IChannelRepository,
    @Inject(INJECTION_TOKENS.VIDEO_REPOSITORY)
    private readonly videoRepository: IVideoRepository,
    @Inject(INJECTION_TOKENS.RSS_FEED)
    private readonly rssFeed: IRSSFeedPort,
    private readonly registerVideoUseCase: RegisterVideoUseCase,
  ) {}

  async execute(input: RegisterChannelInput): Promise<RegisterChannelResult> {
    const { channelId, maxVideos = 15 } = input;
    this.logger.log(`Registering channel: ${channelId}`);

    const result: RegisterChannelResult = {
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
          const registerResult = await this.registerVideoUseCase.execute({
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

          if (registerResult.success) {
            result.successCount++;
          } else {
            if (registerResult.message === MESSAGES.VIDEO.ALREADY_PROCESSED) {
              result.skippedCount++;
              result.processedCount--;
            } else {
              result.failedCount++;
              result.errors.push(`${rssEntry.videoId}: ${registerResult.message}`);
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
      this.logger.error(`  Channel registration failed: ${(error as Error).message}`);
    }

    return result;
  }

  private async getProcessedVideoIds(channelId: string): Promise<Set<string>> {
    try {
      const channel = await this.channelRepository.findById(channelId);
      if (!channel) {
        return new Set();
      }

      const videoIds = await this.videoRepository.getRecentVideoIds(channelId, 50);
      return new Set(videoIds || []);
    } catch (error) {
      this.logger.debug(`Failed to get processed video IDs: ${(error as Error).message}`);
      return new Set();
    }
  }
}
