import { Controller, Get, Post, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { BatchProcessingService } from '@/application/services';
import { BatchProcessingResponseDto, BatchStatusResponseDto } from '../dtos';

/**
 * 배치 컨트롤러
 * 배치 작업 API 엔드포인트
 */
@Controller('batch')
export class BatchController {
  private readonly logger = new Logger(BatchController.name);

  constructor(private readonly batchProcessingService: BatchProcessingService) {}

  /**
   * 배치 작업 상태 조회
   */
  @Get('status')
  getStatus(): BatchStatusResponseDto {
    const status = this.batchProcessingService.getStatus();
    return {
      lastRunAt: status.lastRunAt?.toISOString() || null,
      isRunning: status.isRunning,
      processedChannels: status.processedChannels,
      processedVideos: status.processedVideos,
      newVideosFound: status.newVideosFound,
      errors: status.errors,
    };
  }

  /**
   * 배치 작업 수동 실행
   */
  @Post('run')
  async runBatch(): Promise<BatchProcessingResponseDto> {
    this.logger.log('Manual batch run triggered');

    if (this.batchProcessingService.isRunning()) {
      throw new HttpException(
        'Batch job is already running',
        HttpStatus.CONFLICT,
      );
    }

    const result = await this.batchProcessingService.runBatch();

    return {
      startedAt: result.startedAt.toISOString(),
      completedAt: result.completedAt.toISOString(),
      totalChannels: result.totalChannels,
      totalVideosProcessed: result.totalVideosProcessed,
      totalSuccess: result.totalSuccess,
      totalFailed: result.totalFailed,
      channelResults: result.channelResults,
      errors: result.errors,
    };
  }
}
