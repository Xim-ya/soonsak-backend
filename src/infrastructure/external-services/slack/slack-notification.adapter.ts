import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 배치 결과 알림 데이터
 */
export interface BatchNotificationData {
  totalChannels: number;
  totalVideosProcessed: number;
  totalSuccess: number;
  totalFailed: number;
  durationMs: number;
}

/**
 * Slack 알림 어댑터
 * 배치 작업 완료 시 Slack 웹훅으로 알림 전송
 */
@Injectable()
export class SlackNotificationAdapter {
  private readonly logger = new Logger(SlackNotificationAdapter.name);
  private readonly webhookUrl: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.webhookUrl = this.configService.get<string>('SLACK_WEBHOOK_URL');

    if (!this.webhookUrl) {
      this.logger.warn('SLACK_WEBHOOK_URL not configured - notifications disabled');
    }
  }

  /**
   * 배치 완료 알림 전송
   */
  async sendBatchCompletionNotification(data: BatchNotificationData): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.debug('Slack notification skipped - webhook URL not configured');
      return;
    }

    const durationMinutes = Math.round(data.durationMs / 1000 / 60);
    const successRate = data.totalVideosProcessed > 0
      ? Math.round((data.totalSuccess / data.totalVideosProcessed) * 100)
      : 0;

    const message = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '📺 Soonsak 배치 작업 완료',
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*처리 채널*\n${data.totalChannels}개`,
            },
            {
              type: 'mrkdwn',
              text: `*처리 영상*\n${data.totalVideosProcessed}개`,
            },
            {
              type: 'mrkdwn',
              text: `*성공*\n${data.totalSuccess}개 (${successRate}%)`,
            },
            {
              type: 'mrkdwn',
              text: `*실패*\n${data.totalFailed}개`,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `⏱️ 소요 시간: ${durationMinutes}분`,
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
      }

      this.logger.log('Batch completion notification sent to Slack');
    } catch (error) {
      this.logger.error(`Failed to send Slack notification: ${(error as Error).message}`);
    }
  }
}
