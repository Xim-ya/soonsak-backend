import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS } from '@/shared/constants';
import { IChannelRepository } from '@/domain/repositories';
import { RegisterChannelUseCase, BatchProcessResult } from '@/application/use-cases';

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
    private readonly registerChannelUseCase: RegisterChannelUseCase,
  ) {}

  async runBatch(): Promise<BatchProcessResult> {
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
      channelResults: [],
      errors: [],
    };

    try {
      const channels = await this.channelRepository.findAll();
      result.totalChannels = channels.length;

      this.logger.log(`Starting batch processing for ${channels.length} channels`);

      for (const channel of channels) {
        try {
          const channelResult = await this.registerChannelUseCase.execute({
            channelId: channel.id,
          });

          result.channelResults.push(channelResult);
          result.totalVideosProcessed += channelResult.processedCount;
          result.totalSuccess += channelResult.successCount;
          result.totalFailed += channelResult.failedCount;

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
