import { Controller, Post, Param, Query, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ProcessChannelUseCase, RegisterChannelVideosUseCase } from '@/application/use-cases';
import { ChannelProcessingResponseDto, RegisterChannelVideosResponseDto } from '../dtos';

/**
 * 채널 컨트롤러
 * 채널 처리 API 엔드포인트
 */
@Controller('channels')
export class ChannelsController {
  private readonly logger = new Logger(ChannelsController.name);

  constructor(
    private readonly processChannelUseCase: ProcessChannelUseCase,
    private readonly registerChannelVideosUseCase: RegisterChannelVideosUseCase,
  ) {}

  /**
   * 단일 채널 처리 (최근 영상만)
   */
  @Post(':channelId/register')
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

  /**
   * 채널의 모든 비디오 일괄 등록
   */
  @Post(':channelId/register-all')
  async registerAllVideos(
    @Param('channelId') channelId: string,
    @Query('max') maxVideos?: string,
  ): Promise<RegisterChannelVideosResponseDto> {
    this.logger.log(`Registering all videos for channel: ${channelId}`);

    if (!channelId) {
      throw new HttpException(
        'Channel ID is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const max = maxVideos ? parseInt(maxVideos, 10) : 100;

    const result = await this.registerChannelVideosUseCase.execute({
      channelId,
      maxVideos: max,
    });

    return result;
  }
}
