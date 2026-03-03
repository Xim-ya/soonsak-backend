import {
  Controller,
  Post,
  Get,
  Body,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PushCron } from '@/presentation/cron';

interface TriggerPushDto {
  forceMode?: boolean;
  targetHour?: number;
}

/**
 * 푸시 알림 컨트롤러
 * 푸시 관련 API 엔드포인트
 */
@Controller('push')
export class PushController {
  private readonly logger = new Logger(PushController.name);

  constructor(private readonly pushCron: PushCron) {}

  /**
   * 개인화 푸시 수동 발송
   * POST /push/trigger
   * Body: { forceMode?: boolean, targetHour?: number }
   */
  @Post('trigger')
  async triggerPush(@Body() dto: TriggerPushDto) {
    this.logger.log(
      `Manual push triggered: forceMode=${dto.forceMode}, targetHour=${dto.targetHour}`,
    );

    if (this.pushCron.isCurrentlyRunning()) {
      throw new HttpException('Push job is already running', HttpStatus.CONFLICT);
    }

    const result = await this.pushCron.triggerManualPush(dto.forceMode, dto.targetHour);

    return {
      success: result.success,
      hour: result.hour,
      templateId: result.templateId,
      results: result.results,
      errors: result.errors,
      message: result.message,
    };
  }

  /**
   * 푸시 작업 상태 확인
   * GET /push/status
   */
  @Get('status')
  getStatus() {
    return {
      isRunning: this.pushCron.isCurrentlyRunning(),
      currentHour: (new Date().getUTCHours() + 9) % 24,
    };
  }
}
