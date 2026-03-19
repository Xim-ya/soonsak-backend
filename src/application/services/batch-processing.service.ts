import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS } from '@/shared/constants';
import { IChannelRepository, IFailedVideoRepository } from '@/domain/repositories';
import { RegisterChannelUseCase, BatchProcessResult, FailedVideoInfo } from '@/application/use-cases';
import { SlackNotificationAdapter } from '@/infrastructure/external-services/slack';

/** 배치 처리 기본 설정 */
const DEFAULT_MIN_AGE_HOURS = 25;

/** 채널 간 딜레이 (레이트 리미팅 방지) - 30초로 증가 */
const CHANNEL_PROCESSING_DELAY_MS = 30000;

/** 딜레이 헬퍼 */
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
    @Inject(INJECTION_TOKENS.FAILED_VIDEO_REPOSITORY)
    private readonly failedVideoRepository: IFailedVideoRepository,
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
      totalSkippedPermanentlyFailed: 0,
      totalRetried: 0,
      totalRetrySuccess: 0,
      channelResults: [],
      errors: [],
      failedVideos: [],
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
          result.totalSkippedPermanentlyFailed += channelResult.skippedPermanentlyFailedCount;

          // 실패한 비디오 정보 집계
          result.failedVideos.push(...channelResult.failedVideos);

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

        // 채널 간 딜레이 (레이트 리미팅 방지)
        await delay(CHANNEL_PROCESSING_DELAY_MS);
      }

      result.completedAt = new Date();
      this.logger.log(
        `Batch completed: ${result.totalSuccess} success, ${result.totalFailed} failed`,
      );

      // 최근 실패 비디오 목록 조회 (슬랙 알림용)
      const recentFailures = await this.failedVideoRepository.findRecentFailures(10);
      const failedVideoInfos: FailedVideoInfo[] = recentFailures.map((fv) => ({
        videoId: fv.videoId,
        title: fv.title,
        failureReason: fv.failureReason,
        retryCount: fv.retryCount,
        isNewFailure: false,
      }));

      // Slack 알림 전송
      await this.slackNotifier.sendBatchCompletionNotification({
        totalChannels: result.totalChannels,
        totalVideosProcessed: result.totalVideosProcessed,
        totalSuccess: result.totalSuccess,
        totalFailed: result.totalFailed,
        totalSkippedShorts: result.totalSkippedShorts,
        totalSkippedPermanentlyFailed: result.totalSkippedPermanentlyFailed,
        durationMs: result.completedAt.getTime() - startedAt.getTime(),
        failedVideos: failedVideoInfos,
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
