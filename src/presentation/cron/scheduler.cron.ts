import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { BatchProcessingService } from '@/application/services';

/**
 * 스케줄러 Cron 서비스
 * 매일 새벽 3시 배치 작업 실행
 */
@Injectable()
export class SchedulerCron {
  private readonly logger = new Logger(SchedulerCron.name);
  private readonly isEnabled: boolean;

  constructor(
    private readonly batchProcessingService: BatchProcessingService,
    private readonly configService: ConfigService,
  ) {
    this.isEnabled = this.configService.get<boolean>('SCHEDULER_ENABLED', true);
    this.logger.log(`Scheduler cron ${this.isEnabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 매일 새벽 3시에 배치 작업 실행
   */
  @Cron('0 3 * * *', {
    name: 'daily-video-batch',
    timeZone: 'Asia/Seoul',
  })
  async handleDailyBatch() {
    if (!this.isEnabled) {
      this.logger.log('Scheduler is disabled, skipping batch');
      return;
    }

    if (this.batchProcessingService.isRunning()) {
      this.logger.warn('Batch job is already running, skipping');
      return;
    }

    this.logger.log('Starting daily batch job');

    try {
      const result = await this.batchProcessingService.runBatch();
      this.logger.log(
        `Daily batch completed: ${result.totalSuccess} videos processed, ${result.totalFailed} failed`,
      );
    } catch (error) {
      this.logger.error(`Daily batch failed: ${(error as Error).message}`);
    }
  }
}
