import { Controller, Post, Param, Logger } from '@nestjs/common';
import { RegisterVideoUseCase } from '@/application/use-cases';
import { VideoProcessingResponseDto, VideoIdParam } from '../dtos';

/**
 * 비디오 컨트롤러
 * 비디오 처리 API 엔드포인트
 */
@Controller('videos')
export class VideosController {
  private readonly logger = new Logger(VideosController.name);

  constructor(private readonly registerVideoUseCase: RegisterVideoUseCase) {}

  /**
   * 단일 비디오 등록
   * ValidationPipe가 videoId 형식을 자동으로 검증합니다.
   */
  @Post(':videoId/register')
  async registerVideo(
    @Param() params: VideoIdParam,
  ): Promise<VideoProcessingResponseDto> {
    const { videoId } = params;
    this.logger.log(`Registering single video: ${videoId}`);

    const result = await this.registerVideoUseCase.execute({
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
