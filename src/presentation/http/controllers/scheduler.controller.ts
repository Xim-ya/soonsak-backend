import { Controller, Get, Post, Param, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { BatchProcessingService } from '@/application/services';
import { ProcessVideoUseCase, ProcessChannelUseCase } from '@/application/use-cases';
import {
  VideoProcessingResponseDto,
  ChannelProcessingResponseDto,
  BatchProcessingResponseDto,
  SchedulerStatusResponseDto,
} from '../dtos';

/**
 * 스케줄러 컨트롤러
 * 비디오 처리 및 배치 작업 API 엔드포인트
 */
@Controller('scheduler')
export class SchedulerController {
  private readonly logger = new Logger(SchedulerController.name);

  constructor(
    private readonly batchProcessingService: BatchProcessingService,
    private readonly processVideoUseCase: ProcessVideoUseCase,
    private readonly processChannelUseCase: ProcessChannelUseCase,
  ) {}

  /**
   * 스케줄러 상태 조회
   */
  @Get('status')
  getStatus(): SchedulerStatusResponseDto {
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

  /**
   * 단일 비디오 처리
   */
  @Post('video/:videoId')
  async processVideo(
    @Param('videoId') videoId: string,
  ): Promise<VideoProcessingResponseDto> {
    this.logger.log(`Processing single video: ${videoId}`);

    if (!videoId || videoId.length !== 11) {
      throw new HttpException(
        'Invalid video ID format',
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.processVideoUseCase.execute({
      videoId,
      title: '',
      description: '',
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      channelId: '',
      channelName: '',
      thumbnail: '',
    });

    return result;
  }

  /**
   * 단일 채널 처리
   */
  @Post('channel/:channelId')
  async processChannel(
    @Param('channelId') channelId: string,
  ): Promise<ChannelProcessingResponseDto> {
    this.logger.log(`Processing single channel: ${channelId}`);

    if (!channelId) {
      throw new HttpException(
        'Channel ID is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.processChannelUseCase.execute({
      channelId,
    });

    return result;
  }
}
