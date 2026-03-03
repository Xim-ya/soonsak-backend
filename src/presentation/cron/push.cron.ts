import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SendPersonalizedPushUseCase } from '@/application/use-cases';
import { SlackNotificationAdapter } from '@/infrastructure/external-services/slack/slack-notification.adapter';
import { INJECTION_TOKENS } from '@/shared/constants';

/**
 * 개인화 푸시 Cron 서비스
 * 매 시간 정각에 해당 시간대 사용자에게 추천 푸시 발송
 */
@Injectable()
export class PushCron {
  private readonly logger = new Logger(PushCron.name);
  private readonly isEnabled: boolean;
  private isRunning = false;

  constructor(
    private readonly sendPersonalizedPushUseCase: SendPersonalizedPushUseCase,
    private readonly configService: ConfigService,
    @Inject(INJECTION_TOKENS.SLACK_NOTIFIER)
    private readonly slackNotification: SlackNotificationAdapter,
  ) {
    this.isEnabled = this.configService.get<boolean>('PUSH_CRON_ENABLED', true);
    this.logger.log(`Push cron ${this.isEnabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 매 시간 정각에 개인화 푸시 발송
   * Cron 표현식: 초 분 시 일 월 요일
   * 0 0 * * * * - 매 시간 정각
   */
  @Cron('0 0 * * * *', {
    name: 'personalized-push',
    timeZone: 'Asia/Seoul',
  })
  async handlePersonalizedPush() {
    if (!this.isEnabled) {
      this.logger.log('Push cron is disabled, skipping');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Push job is already running, skipping');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting scheduled personalized push');

    try {
      const result = await this.sendPersonalizedPushUseCase.execute();

      if (result.success) {
        this.logger.log(
          `Push completed: hour=${result.hour}, sent=${result.results.sent}, failed=${result.results.failed}, skipped=${result.results.skipped}`,
        );
      } else {
        this.logger.error(`Push failed: ${result.message}`);
      }

      // 발송 건수가 있을 때만 Slack 알림
      if (result.results.sent > 0 || result.results.failed > 0) {
        await this.sendSlackNotification(result);
      }
    } catch (error) {
      this.logger.error(`Push cron error: ${(error as Error).message}`);

      await this.slackNotification.sendErrorNotification(
        'Push Cron 오류',
        '개인화 푸시 발송 중 오류가 발생했습니다.',
        (error as Error).message,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 수동 트리거 (테스트/관리자용)
   */
  async triggerManualPush(forceMode: boolean = false, targetHour?: number) {
    if (this.isRunning) {
      throw new Error('Push job is already running');
    }

    this.isRunning = true;
    this.logger.log(`Starting manual push: forceMode=${forceMode}, targetHour=${targetHour}`);

    try {
      const result = await this.sendPersonalizedPushUseCase.execute({
        forceMode,
        targetHour,
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

  private async sendSlackNotification(result: {
    success: boolean;
    hour: number;
    results: { sent: number; failed: number; skipped: number };
    errors: string[];
    message?: string;
  }): Promise<void> {
    const statusEmoji = result.success ? '✅' : '❌';
    const statusText = result.success ? '완료' : '실패';

    const message = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `📱 개인화 푸시 발송 ${statusText}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*발송 시간*\n${result.hour}시 (KST)`,
            },
            {
              type: 'mrkdwn',
              text: `*발송 성공*\n${result.results.sent}건`,
            },
            {
              type: 'mrkdwn',
              text: `*발송 실패*\n${result.results.failed}건`,
            },
            {
              type: 'mrkdwn',
              text: `*스킵*\n${result.results.skipped}건`,
            },
          ],
        },
        ...(result.errors.length > 0
          ? [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*오류*\n\`\`\`${result.errors.slice(0, 3).join('\n')}\`\`\``,
                },
              },
            ]
          : []),
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🕐 ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
            },
          ],
        },
      ],
    };

    try {
      const webhookUrl = this.configService.get<string>('SLACK_WEBHOOK_URL');
      if (webhookUrl) {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
        });
      }
    } catch (error) {
      this.logger.error(`Failed to send Slack notification: ${(error as Error).message}`);
    }
  }
}
