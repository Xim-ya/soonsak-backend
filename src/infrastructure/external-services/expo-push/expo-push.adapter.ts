import { Injectable, Logger } from '@nestjs/common';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound?: 'default' | null;
  data?: Record<string, unknown>;
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
}

export interface ExpoPushResult {
  success: boolean;
  ticketId?: string;
  error?: string;
}

/**
 * Expo Push Notification 어댑터
 * Expo Push API를 통해 푸시 알림 발송
 */
@Injectable()
export class ExpoPushAdapter {
  private readonly logger = new Logger(ExpoPushAdapter.name);

  /**
   * 단일 푸시 알림 발송
   */
  async sendPush(message: ExpoPushMessage): Promise<ExpoPushResult> {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...message,
          sound: message.sound ?? 'default',
        }),
      });

      const result = await response.json();

      if (result.data?.status === 'ok' || result.data?.id) {
        this.logger.debug(`Push sent successfully: ${result.data?.id}`);
        return {
          success: true,
          ticketId: result.data?.id,
        };
      }

      const errorMessage = result.data?.message || result.errors?.[0]?.message || 'Unknown error';
      this.logger.warn(`Push failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.logger.error(`Push send error: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 다중 푸시 알림 발송 (배치)
   */
  async sendPushBatch(messages: ExpoPushMessage[]): Promise<ExpoPushResult[]> {
    const results: ExpoPushResult[] = [];

    // Expo는 최대 100개씩 배치 처리 권장
    const BATCH_SIZE = 100;
    const batches: ExpoPushMessage[][] = [];

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      batches.push(messages.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
      try {
        const response = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            batch.map((msg) => ({
              ...msg,
              sound: msg.sound ?? 'default',
            })),
          ),
        });

        const result = await response.json();
        const tickets: ExpoPushTicket[] = result.data || [];

        for (const ticket of tickets) {
          if (ticket.status === 'ok') {
            results.push({ success: true, ticketId: ticket.id });
          } else {
            results.push({
              success: false,
              error: ticket.message || ticket.details?.error || 'Unknown error',
            });
          }
        }
      } catch (error) {
        // 배치 전체 실패 시 모든 메시지에 대해 실패 처리
        for (let i = 0; i < batch.length; i++) {
          results.push({
            success: false,
            error: (error as Error).message,
          });
        }
      }
    }

    return results;
  }
}
