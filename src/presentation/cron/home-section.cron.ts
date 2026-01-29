import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { GenerateHomeSectionsUseCase } from '@/application/use-cases';
import { INJECTION_TOKENS } from '@/shared/constants';

/**
 * 홈 섹션 Cron 서비스
 * 3일마다 새벽 4시에 AI 기반 홈 섹션 자동 생성
 */
@Injectable()
export class HomeSectionCron {
  private readonly logger = new Logger(HomeSectionCron.name);
  private readonly isEnabled: boolean;
  private isRunning = false;

  constructor(
    private readonly generateHomeSectionsUseCase: GenerateHomeSectionsUseCase,
    private readonly configService: ConfigService,
  ) {
    this.isEnabled = this.configService.get<boolean>('HOME_SECTION_CRON_ENABLED', true);
    this.logger.log(`Home section cron ${this.isEnabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 매 3일마다 새벽 4시에 홈 섹션 생성
   * Cron 표현식: 분 시 일 월 요일
   * 0 4 (매3일) - 3일마다 4시 0분
   */
  @Cron('0 4 */3 * *', {
    name: 'home-section-generation',
    timeZone: 'Asia/Seoul',
  })
  async handleHomeSectionGeneration() {
    if (!this.isEnabled) {
      this.logger.log('Home section cron is disabled, skipping');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Home section generation is already running, skipping');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting scheduled home section generation');

    try {
      const result = await this.generateHomeSectionsUseCase.execute({
        sectionCount: 5,
        itemsPerSection: 10,
        forceRegenerate: true, // 스케줄 실행 시에는 항상 새로 생성
      });

      if (result.success) {
        this.logger.log(
          `Home section generation completed: ${result.sectionCount} sections created, expires at ${result.expiresAt.toISOString()}`,
        );
      } else {
        this.logger.error(`Home section generation failed: ${result.message}`);
      }
    } catch (error) {
      this.logger.error(
        `Home section generation error: ${(error as Error).message}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 수동 트리거 (테스트/관리자용)
   */
  async triggerManualGeneration(forceRegenerate: boolean = false) {
    if (this.isRunning) {
      throw new Error('Home section generation is already running');
    }

    this.isRunning = true;
    this.logger.log('Starting manual home section generation');

    try {
      const result = await this.generateHomeSectionsUseCase.execute({
        sectionCount: 5,
        itemsPerSection: 10,
        forceRegenerate,
      });

      return result;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 현재 실행 중인지 확인
   */
  isCurrentlyRunning(): boolean {
    return this.isRunning;
  }
}
