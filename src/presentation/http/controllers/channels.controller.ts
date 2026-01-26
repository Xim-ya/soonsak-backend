import { Controller, Post, Param, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ProcessChannelUseCase } from '@/application/use-cases';
import { ChannelProcessingResponseDto } from '../dtos';

/**
 * 채널 컨트롤러
 * 채널 처리 API 엔드포인트
 */
@Controller('channels')
export class ChannelsController {
  private readonly logger = new Logger(ChannelsController.name);

  constructor(private readonly processChannelUseCase: ProcessChannelUseCase) {}

  /**
   * 단일 채널 처리
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
}
