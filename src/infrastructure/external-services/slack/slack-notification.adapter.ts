import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 실패한 비디오 정보
 */
export interface FailedVideoNotificationInfo {
  videoId: string;
  title: string;
  failureReason: string;
  retryCount: number;
  isNewFailure: boolean;
}

/**
 * 배치 결과 알림 데이터
 */
export interface BatchNotificationData {
  totalChannels: number;
  totalVideosProcessed: number;
  totalSuccess: number;
  totalFailed: number;
  totalSkippedShorts: number;
  totalSkippedPermanentlyFailed?: number;
  durationMs: number;
  failedVideos?: FailedVideoNotificationInfo[];
}

/**
 * 홈 큐레이션 생성 결과 알림 데이터
 */
export interface HomeCurationNotificationData {
  success: boolean;
  sections: Array<{
    title: string;
    contentCount: number;
  }>;
  generatedAt: Date;
  message?: string;
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

    // 실패 비디오 목록 생성 (최대 5개만 표시)
    const failedVideosBlocks = this.buildFailedVideosBlocks(data.failedVideos || []);

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
        ...(data.totalSkippedShorts > 0 || (data.totalSkippedPermanentlyFailed && data.totalSkippedPermanentlyFailed > 0)
          ? [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: [
                    data.totalSkippedShorts > 0 ? `🎬 *스킵된 쇼츠*: ${data.totalSkippedShorts}개` : '',
                    data.totalSkippedPermanentlyFailed && data.totalSkippedPermanentlyFailed > 0
                      ? `🚫 *영구 실패 스킵*: ${data.totalSkippedPermanentlyFailed}개`
                      : '',
                  ].filter(Boolean).join('\n'),
                },
              },
            ]
          : []),
        ...failedVideosBlocks,
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

  /**
   * 실패 비디오 목록 블록 생성
   */
  private buildFailedVideosBlocks(failedVideos: FailedVideoNotificationInfo[]): object[] {
    if (failedVideos.length === 0) {
      return [];
    }

    const blocks: object[] = [
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `❌ *실패한 비디오 목록* (${failedVideos.length}개)`,
        },
      },
    ];

    // 최대 5개만 표시
    const displayVideos = failedVideos.slice(0, 5);

    for (const video of displayVideos) {
      const retryInfo = video.retryCount >= 3
        ? '🚫 영구 실패'
        : `🔄 재시도 ${video.retryCount}/3`;
      const truncatedTitle = video.title.length > 40
        ? `${video.title.substring(0, 40)}...`
        : video.title;
      const truncatedReason = video.failureReason.length > 50
        ? `${video.failureReason.substring(0, 50)}...`
        : video.failureReason;

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• *${truncatedTitle}*\n  └ ID: \`${video.videoId}\`\n  └ 사유: ${truncatedReason}\n  └ ${retryInfo}`,
        },
      });
    }

    if (failedVideos.length > 5) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `... 외 ${failedVideos.length - 5}개`,
          },
        ],
      });
    }

    return blocks;
  }

  /**
   * 긴급 오류 알림 전송
   */
  async sendErrorNotification(title: string, message: string, details?: string): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.debug('Slack notification skipped - webhook URL not configured');
      return;
    }

    const slackMessage = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🚨 ${title}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message,
          },
        },
        ...(details
          ? [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `\`\`\`${details.substring(0, 500)}\`\`\``,
                },
              },
            ]
          : []),
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🕐 발생 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackMessage),
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
      }

      this.logger.log('Error notification sent to Slack');
    } catch (error) {
      this.logger.error(`Failed to send Slack notification: ${(error as Error).message}`);
    }
  }

  /**
   * 홈 큐레이션 생성 완료 알림 전송
   */
  async sendHomeCurationNotification(data: HomeCurationNotificationData): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.debug('Slack notification skipped - webhook URL not configured');
      return;
    }

    const statusEmoji = data.success ? '✅' : '❌';
    const statusText = data.success ? '성공' : '실패';

    const sectionFields = data.sections.map((section) => ({
      type: 'mrkdwn',
      text: `• *${section.title}*\n  └ 콘텐츠 ${section.contentCount}개`,
    }));

    const message = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🎬 홈 큐레이션 생성 ${statusText}`,
            emoji: true,
          },
        },
        ...(data.success
          ? [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*생성된 섹션 (${data.sections.length}개)*`,
                },
              },
              ...sectionFields.map((field) => ({
                type: 'section',
                text: field,
              })),
            ]
          : [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `${statusEmoji} ${data.message || '알 수 없는 오류'}`,
                },
              },
            ]),
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🕐 생성 시각: ${data.generatedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
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

      this.logger.log('Home curation notification sent to Slack');
    } catch (error) {
      this.logger.error(`Failed to send Slack notification: ${(error as Error).message}`);
    }
  }
}
