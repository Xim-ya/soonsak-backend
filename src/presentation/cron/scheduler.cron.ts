import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { BatchProcessingService } from '@/application/services';

/**
 * 스케줄러 Cron 서비스
 * 4시간마다 배치 작업 실행 (Rate limit 분산)
 * - DB에 등록된 모든 채널의 최근 영상을 조회
 * - 게시일이 25시간 이전인 영상만 필터링하여 처리
 * - 1시, 5시, 9시, 13시, 17시, 21시 (KST) 실행
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
   * 4시간마다 배치 작업 실행 (Rate limit 분산)
   * 실행 시간: 1시, 5시, 9시, 13시, 17시, 21시 (KST)
   * 25시간 이전에 게시된 영상만 처리 (자막 등이 준비될 시간 확보)
   */
  @Cron('0 1,5,9,13,17,21 * * *', {
    name: 'distributed-video-batch',
    timeZone: 'Asia/Seoul',
  })
  async handleDistributedBatch() {
    if (!this.isEnabled) {
      this.logger.log('Scheduler is disabled, skipping batch');
      return;
    }

    if (this.batchProcessingService.isRunning()) {
      this.logger.warn('Batch job is already running, skipping');
      return;
    }

    const hour = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false });
    this.logger.log(`Starting distributed batch job (${hour}:00 KST)`);

    try {
      const result = await this.batchProcessingService.runBatch();
      this.logger.log(
        `Batch completed: ${result.totalSuccess} videos processed, ${result.totalFailed} failed`,
      );
    } catch (error) {
      this.logger.error(`Batch failed: ${(error as Error).message}`);
    }
  }
}
