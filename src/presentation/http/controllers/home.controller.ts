import { Controller, Post, Get, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HomeSectionCron } from '@/presentation/cron';

/**
 * 홈 컨트롤러
 * 홈 큐레이션 관련 API 엔드포인트
 */
@Controller('home')
export class HomeController {
  private readonly logger = new Logger(HomeController.name);

  constructor(private readonly homeSectionCron: HomeSectionCron) {}

  /**
   * 홈 섹션 수동 재생성
   */
  @Post('sections/regenerate')
  async regenerateSections() {
    this.logger.log('Manual home section regeneration triggered');

    if (this.homeSectionCron.isCurrentlyRunning()) {
      throw new HttpException(
        'Home section generation is already running',
        HttpStatus.CONFLICT,
      );
    }

    const result = await this.homeSectionCron.triggerManualGeneration(true);

    return {
      success: result.success,
      sectionCount: result.sectionCount,
      sections: result.sections,
      generatedAt: result.generatedAt.toISOString(),
      message: result.message,
    };
  }
}
