import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { BatchProcessingService } from '@/application/services';

/**
 * 스케줄러 Cron 서비스
 * 매일 오전 6시 배치 작업 실행
 * - DB에 등록된 모든 채널의 최근 영상을 조회
 * - 게시일이 25시간 이전인 영상만 필터링하여 처리
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
   * 매일 오전 6시에 배치 작업 실행
   * 25시간 이전에 게시된 영상만 처리 (자막 등이 준비될 시간 확보)
   */
  @Cron('10 1 * * *', {
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
