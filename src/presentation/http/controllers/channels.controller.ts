import { Controller, Post, Param, Query, Logger } from '@nestjs/common';
import { RegisterChannelUseCase, RegisterChannelVideosUseCase } from '@/application/use-cases';
import {
  ChannelProcessingResponseDto,
  RegisterChannelVideosResponseDto,
  ChannelIdParam,
} from '../dtos';

/**
 * 채널 컨트롤러
 * 채널 처리 API 엔드포인트
 */
@Controller('channels')
export class ChannelsController {
  private readonly logger = new Logger(ChannelsController.name);

  constructor(
    private readonly registerChannelUseCase: RegisterChannelUseCase,
    private readonly registerChannelVideosUseCase: RegisterChannelVideosUseCase,
  ) {}

  /**
   * 단일 채널 등록 (최근 영상만)
   * ValidationPipe가 channelId를 자동으로 검증합니다.
   */
  @Post(':channelId/register')
  async registerChannel(
    @Param() params: ChannelIdParam,
  ): Promise<ChannelProcessingResponseDto> {
    const { channelId } = params;
    this.logger.log(`Registering single channel: ${channelId}`);

    const result = await this.registerChannelUseCase.execute({
      channelId,
    });

    return result;
  }

  /**
   * 채널의 모든 비디오 일괄 등록
   * ValidationPipe가 channelId를 자동으로 검증합니다.
   */
  @Post(':channelId/register-all')
  async registerAllVideos(
    @Param() params: ChannelIdParam,
    @Query('max') maxVideos?: string,
  ): Promise<RegisterChannelVideosResponseDto> {
    const { channelId } = params;
    this.logger.log(`Registering all videos for channel: ${channelId}`);

    const max = maxVideos ? parseInt(maxVideos, 10) : 100;

    const result = await this.registerChannelVideosUseCase.execute({
      channelId,
      maxVideos: max,
    });

    return result;
  }
}
