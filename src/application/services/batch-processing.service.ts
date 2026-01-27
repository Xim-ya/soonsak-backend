import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS } from '@/shared/constants';
import { IChannelRepository } from '@/domain/repositories';
import { RegisterChannelUseCase, BatchProcessResult } from '@/application/use-cases';
import { SlackNotificationAdapter } from '@/infrastructure/external-services/slack';

/** 배치 처리 기본 설정 */
const DEFAULT_MIN_AGE_HOURS = 25;

/**
 * 스케줄러 작업 상태
 */
export interface SchedulerJobStatus {
  lastRunAt: Date | null;
  isRunning: boolean;
  processedChannels: number;
  processedVideos: number;
  newVideosFound: number;
  errors: string[];
}

/**
 * 배치 처리 서비스
 * 전체 채널 배치 처리 오케스트레이션
 */
@Injectable()
export class BatchProcessingService {
  private readonly logger = new Logger(BatchProcessingService.name);
  private jobStatus: SchedulerJobStatus = {
    lastRunAt: null,
    isRunning: false,
    processedChannels: 0,
    processedVideos: 0,
    newVideosFound: 0,
    errors: [],
  };

  constructor(
    @Inject(INJECTION_TOKENS.CHANNEL_REPOSITORY)
    private readonly channelRepository: IChannelRepository,
    @Inject(INJECTION_TOKENS.SLACK_NOTIFIER)
    private readonly slackNotifier: SlackNotificationAdapter,
    private readonly registerChannelUseCase: RegisterChannelUseCase,
  ) {}

  /**
   * 배치 작업 실행
   * @param minAgeHours 영상 게시일 기준 최소 경과 시간 (기본값: 25시간)
   */
  async runBatch(minAgeHours: number = DEFAULT_MIN_AGE_HOURS): Promise<BatchProcessResult> {
    if (this.jobStatus.isRunning) {
      throw new Error('Batch job is already running');
    }

    const startedAt = new Date();
    this.jobStatus = {
      lastRunAt: startedAt,
      isRunning: true,
      processedChannels: 0,
      processedVideos: 0,
      newVideosFound: 0,
      errors: [],
    };

    const result: BatchProcessResult = {
      startedAt,
      completedAt: new Date(),
      totalChannels: 0,
      totalVideosProcessed: 0,
      totalSuccess: 0,
      totalFailed: 0,
      totalSkippedShorts: 0,
      channelResults: [],
      errors: [],
    };

    try {
      const channels = await this.channelRepository.findAll();
      result.totalChannels = channels.length;

      this.logger.log(
        `Starting batch processing for ${channels.length} channels (minAgeHours: ${minAgeHours})`,
      );

      for (const channel of channels) {
        try {
          const channelResult = await this.registerChannelUseCase.execute({
            channelId: channel.id,
            minAgeHours,
          });

          result.channelResults.push(channelResult);
          result.totalVideosProcessed += channelResult.processedCount;
          result.totalSuccess += channelResult.successCount;
          result.totalFailed += channelResult.failedCount;
          result.totalSkippedShorts += channelResult.skippedShortsCount;

          this.jobStatus.processedChannels++;
          this.jobStatus.processedVideos += channelResult.processedCount;
          this.jobStatus.newVideosFound += channelResult.successCount;

          if (channelResult.errors.length > 0) {
            this.jobStatus.errors.push(...channelResult.errors);
            result.errors.push(...channelResult.errors);
          }
        } catch (error) {
          const errorMsg = `Channel ${channel.id}: ${(error as Error).message}`;
          this.jobStatus.errors.push(errorMsg);
          result.errors.push(errorMsg);
          this.logger.error(errorMsg);
        }
      }

      result.completedAt = new Date();
      this.logger.log(
        `Batch completed: ${result.totalSuccess} success, ${result.totalFailed} failed`,
      );

      // Slack 알림 전송
      await this.slackNotifier.sendBatchCompletionNotification({
        totalChannels: result.totalChannels,
        totalVideosProcessed: result.totalVideosProcessed,
        totalSuccess: result.totalSuccess,
        totalFailed: result.totalFailed,
        totalSkippedShorts: result.totalSkippedShorts,
        durationMs: result.completedAt.getTime() - startedAt.getTime(),
      });
    } finally {
      this.jobStatus.isRunning = false;
    }

    return result;
  }

  getStatus(): SchedulerJobStatus {
    return { ...this.jobStatus };
  }

  isRunning(): boolean {
    return this.jobStatus.isRunning;
  }
}
