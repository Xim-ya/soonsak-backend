import { Controller, Post, Param, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ProcessVideoUseCase } from '@/application/use-cases';
import { VideoProcessingResponseDto } from '../dtos';

/**
 * 비디오 컨트롤러
 * 비디오 처리 API 엔드포인트
 */
@Controller('videos')
export class VideosController {
  private readonly logger = new Logger(VideosController.name);

  constructor(private readonly processVideoUseCase: ProcessVideoUseCase) {}

  /**
   * 단일 비디오 처리
   */
  @Post(':videoId/register')
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
}
