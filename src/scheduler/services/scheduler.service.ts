import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ChannelService } from '@/channel';
import { VideoProcessorService } from '@/video-processor';
import { SchedulerJobStatus } from '@/common/types';
import { delay } from '@/common/utils';

/**
 * Scheduler Service
 * Handles cron-based video processing and batch operations
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private isEnabled = false;
  private batchSize = 10;
  private isRunning = false;
  private jobStatus: SchedulerJobStatus = {
    lastRunAt: null,
    isRunning: false,
    processedChannels: 0,
    processedVideos: 0,
    newVideosFound: 0,
    errors: [],
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly channelService: ChannelService,
    private readonly videoProcessor: VideoProcessorService,
  ) {}

  onModuleInit() {
    this.isEnabled = this.configService.get<string>('SCHEDULER_ENABLED') === 'true';
    this.batchSize = parseInt(this.configService.get<string>('SCHEDULER_BATCH_SIZE') || '10', 10);

    this.logger.log(`Scheduler initialized - Enabled: ${this.isEnabled}, BatchSize: ${this.batchSize}`);
  }

  /**
   * Get current job status
   */
  getStatus(): SchedulerJobStatus {
    return { ...this.jobStatus };
  }

  /**
   * Cron job: Run every day at 3 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron() {
    if (!this.isEnabled) {
      this.logger.log('Scheduler is disabled, skipping cron job');
      return;
    }

    await this.runBatch();
  }

  /**
   * Manual trigger for full batch processing
   */
  async runBatch(): Promise<SchedulerJobStatus> {
    if (this.isRunning) {
      this.logger.warn('Batch job is already running');
      return this.jobStatus;
    }

    this.isRunning = true;
    this.jobStatus = {
      lastRunAt: new Date(),
      isRunning: true,
      processedChannels: 0,
      processedVideos: 0,
      newVideosFound: 0,
      errors: [],
    };

    this.logger.log('🚀 Starting batch processing...');

    try {
      const channels = await this.channelService.getAllChannels();
      this.logger.log(`📺 Found ${channels.length} channels to process`);

      for (const channel of channels) {
        try {
          await this.processChannel(channel.id, channel.name);
          this.jobStatus.processedChannels++;
        } catch (error) {
          const errorMsg = `Channel ${channel.name}: ${(error as Error).message}`;
          this.logger.error(errorMsg);
          this.jobStatus.errors.push(errorMsg);
        }

        await delay(1000);
      }

      this.logger.log(
        `✅ Batch completed - Channels: ${this.jobStatus.processedChannels}, Videos: ${this.jobStatus.processedVideos}, New: ${this.jobStatus.newVideosFound}`,
      );
    } catch (error) {
      this.logger.error('Batch processing failed', error);
      this.jobStatus.errors.push(`Batch failed: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
      this.jobStatus.isRunning = false;
    }

    return this.jobStatus;
  }

  /**
   * Process a single channel
   */
  async processChannel(
    channelId: string,
    channelName?: string,
  ): Promise<{
    processed: number;
    newVideos: number;
    errors: string[];
  }> {
    const result = {
      processed: 0,
      newVideos: 0,
      errors: [] as string[],
    };

    this.logger.log(`📡 Processing channel: ${channelName || channelId}`);

    try {
      const recentVideos = await this.channelService.getRecentVideos(channelId, this.batchSize);
      this.logger.log(`  Found ${recentVideos.length} videos in RSS`);

      if (recentVideos.length === 0) {
        return result;
      }

      const newVideos = await this.channelService.filterNewVideos(channelId, recentVideos);
      this.logger.log(`  ${newVideos.length} new videos to process`);

      if (newVideos.length === 0) {
        return result;
      }

      for (const video of newVideos) {
        try {
          const processResult = await this.videoProcessor.processVideo(video);
          result.processed++;
          this.jobStatus.processedVideos++;

          if (processResult.success) {
            result.newVideos++;
            this.jobStatus.newVideosFound++;
          }
        } catch (error) {
          const errorMsg = `Video ${video.videoId}: ${(error as Error).message}`;
          result.errors.push(errorMsg);
        }

        await delay(500);
      }

      this.logger.log(`  ✅ Channel done - Processed: ${result.processed}, New: ${result.newVideos}`);
    } catch (error) {
      const errorMsg = `Channel processing error: ${(error as Error).message}`;
      result.errors.push(errorMsg);
      this.logger.error(errorMsg);
    }

    return result;
  }

  /**
   * Process a single video by ID
   */
  async processSingleVideo(videoId: string): Promise<any> {
    this.logger.log(`Processing single video: ${videoId}`);

    const mockEntry = {
      videoId,
      title: '',
      description: '',
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      channelId: '',
      channelName: '',
      thumbnail: '',
    };

    return this.videoProcessor.processVideo(mockEntry);
  }
}
