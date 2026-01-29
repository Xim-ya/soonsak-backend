import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { GenerateHomeSectionsUseCase } from '@/application/use-cases';
import { SlackNotificationAdapter } from '@/infrastructure/external-services/slack/slack-notification.adapter';
import { INJECTION_TOKENS } from '@/shared/constants';

/**
 * 홈 큐레이션 Cron 서비스
 * 매일 오후 12시 30분에 AI 기반 홈 큐레이션 자동 생성
 */
@Injectable()
export class HomeSectionCron {
  private readonly logger = new Logger(HomeSectionCron.name);
  private readonly isEnabled: boolean;
  private isRunning = false;

  constructor(
    private readonly generateHomeSectionsUseCase: GenerateHomeSectionsUseCase,
    private readonly configService: ConfigService,
    @Inject(INJECTION_TOKENS.SLACK_NOTIFIER)
    private readonly slackNotification: SlackNotificationAdapter,
  ) {
    this.isEnabled = this.configService.get<boolean>('HOME_SECTION_CRON_ENABLED', true);
    this.logger.log(`Home curation cron ${this.isEnabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 매일 오후 12시 30분에 홈 큐레이션 생성
   * Cron 표현식: 분 시 일 월 요일
   * 30 12 * * * - 매일 12시 30분
   */
  @Cron('30 12 * * *', {
    name: 'home-curation-generation',
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
          `Home curation generation completed: ${result.sectionCount} sections created at ${result.generatedAt.toISOString()}`,
        );
      } else {
        this.logger.error(`Home curation generation failed: ${result.message}`);
      }

      // Slack 알림 전송
      await this.slackNotification.sendHomeCurationNotification({
        success: result.success,
        sections: result.sections,
        generatedAt: result.generatedAt,
        message: result.message,
      });
    } catch (error) {
      this.logger.error(
        `Home curation generation error: ${(error as Error).message}`,
      );

      // 실패 시에도 Slack 알림 전송
      await this.slackNotification.sendHomeCurationNotification({
        success: false,
        sections: [],
        generatedAt: new Date(),
        message: (error as Error).message,
      });
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
