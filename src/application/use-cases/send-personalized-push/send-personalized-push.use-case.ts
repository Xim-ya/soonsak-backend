import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS } from '@/shared/constants';
import { ExpoPushAdapter } from '@/infrastructure/external-services/expo-push';
import {
  SupabasePushRepository,
  PushTarget,
  PushTemplate,
  RecommendedContent,
} from '@/infrastructure/persistence/supabase/repositories';

const TEMPLATE_NAME = '개인화 콘텐츠 추천';
const MAX_TAGLINE_LENGTH = 20;

// 스펙에 정의된 Body 문구 풀 (tagline 없을 때 사용)
const BODY_MESSAGE_POOL = {
  // 호기심 자극형
  curiosity: [
    '결말 반전이 미쳤대요',
    '다들 이거 보고 울었다던데',
    '2시간이 10분처럼 느껴지는 영화',
    '보다가 멈출 수가 없었어요',
    '첫 10분 보면 끝까지 봅니다',
  ],
  // 대화체 (친근한 말투)
  casual: [
    '오늘 뭐 봐요?',
    '심심할 때 이거 어때요',
    '혹시 이거 보셨어요?',
    '아직 안 보셨으면 지금이에요',
    '이건 진짜 추천이에요',
  ],
  // 시간/상황 맥락형
  contextual: [
    '퇴근길에 딱이에요',
    '자기 전에 보기 좋아요',
    '주말에 정주행 각',
    '오늘 같은 날 보기 좋은 영화',
  ],
  // FOMO형
  fomo: [
    '다들 이미 봤대요',
    '요즘 이거 안 보면 손해',
    '지금 안 보면 스포 당해요',
  ],
  // 미니멀형
  minimal: [
    '명작이에요',
    '설명 필요 없음. 그냥 보세요',
    '믿고 보세요',
    '후회 안 해요',
  ],
};

export interface SendPersonalizedPushInput {
  forceMode?: boolean; // 2일 경과 조건 무시
  targetHour?: number; // 특정 시간대 지정 (기본: 현재 KST 시간)
}

export interface SendPersonalizedPushResult {
  success: boolean;
  hour: number;
  templateId?: string;
  results: {
    sent: number;
    failed: number;
    skipped: number;
  };
  errors: string[];
  message?: string;
}

/**
 * 개인화 푸시 발송 Use Case
 * 사용자별 최적 시간에 추천 콘텐츠 푸시 발송
 */
@Injectable()
export class SendPersonalizedPushUseCase {
  private readonly logger = new Logger(SendPersonalizedPushUseCase.name);

  constructor(
    @Inject(INJECTION_TOKENS.PUSH_REPOSITORY)
    private readonly pushRepository: SupabasePushRepository,
    @Inject(INJECTION_TOKENS.EXPO_PUSH_SERVICE)
    private readonly expoPushService: ExpoPushAdapter,
  ) {}

  async execute(input: SendPersonalizedPushInput = {}): Promise<SendPersonalizedPushResult> {
    const { forceMode = false, targetHour } = input;

    // 현재 KST 시간 계산
    const now = new Date();
    const kstHour = targetHour ?? (now.getUTCHours() + 9) % 24;

    this.logger.log(
      `Starting personalized push at KST hour: ${kstHour}, forceMode: ${forceMode}`,
    );

    const results = {
      sent: 0,
      failed: 0,
      skipped: 0,
    };
    const errors: string[] = [];

    try {
      // 1. 템플릿 조회
      const template = await this.pushRepository.getActiveTemplate(TEMPLATE_NAME);

      if (!template) {
        return {
          success: false,
          hour: kstHour,
          results,
          errors: [`Template not found: ${TEMPLATE_NAME}`],
          message: 'Template not found',
        };
      }

      this.logger.log(`Using template: ${template.id}`);

      // 2. 푸시 대상 사용자 조회
      const targets = forceMode
        ? await this.pushRepository.getAllPushTargetsForHour(kstHour)
        : await this.pushRepository.getPushTargetsForCurrentHour(kstHour);

      if (!targets || targets.length === 0) {
        return {
          success: true,
          hour: kstHour,
          templateId: template.id,
          results,
          errors: [],
          message: `No users to send push at hour ${kstHour}`,
        };
      }

      this.logger.log(`Found ${targets.length} users to send push`);

      // 3. 각 사용자별로 추천 콘텐츠 조회 및 푸시 발송
      for (const target of targets) {
        try {
          await this.sendPushToUser(target, template, results, errors);
        } catch (err) {
          results.failed++;
          errors.push(`User ${target.user_id}: ${(err as Error).message}`);
        }
      }

      // 4. 템플릿 last_run_at 업데이트
      await this.pushRepository.updateTemplateLastRunAt(template.id);

      this.logger.log(
        `Push scheduler completed: sent=${results.sent}, failed=${results.failed}, skipped=${results.skipped}`,
      );

      return {
        success: true,
        hour: kstHour,
        templateId: template.id,
        results,
        errors,
      };
    } catch (error) {
      this.logger.error(`Push scheduler error: ${(error as Error).message}`);
      return {
        success: false,
        hour: kstHour,
        results,
        errors: [(error as Error).message],
        message: (error as Error).message,
      };
    }
  }

  private async sendPushToUser(
    target: PushTarget,
    template: PushTemplate,
    results: { sent: number; failed: number; skipped: number },
    errors: string[],
  ): Promise<void> {
    // 추천 콘텐츠 조회
    const recommendations = await this.pushRepository.getRecommendedContentForUser(
      target.user_id,
      1,
    );

    if (!recommendations || recommendations.length === 0) {
      this.logger.debug(`No recommendations for user ${target.user_id}`);
      results.skipped++;
      return;
    }

    const content = recommendations[0];
    const userName = target.display_name || '회원';

    // tagline 기반 문구 생성
    const { title, body } = this.generatePushMessage(content, userName);

    // 앱 딥링크 페이로드 구성
    const pushData = {
      version: '1.0',
      action: {
        type: 'NAVIGATION',
        screen: 'ContentDetail',
        params: {
          id: content.content_id,
          type: content.content_type,
          title: content.title,
        },
      },
    };

    // Expo Push API 호출
    const pushResult = await this.expoPushService.sendPush({
      to: target.push_token,
      title,
      body,
      data: pushData,
    });

    if (pushResult.success) {
      // 푸시 알림 기록 저장
      const notificationId = await this.pushRepository.createPushNotification({
        template_id: template.id,
        notification_type: 'recommendation',
        title,
        body,
        action_type: template.action_type || 'nav_content',
        content_id: content.content_id,
        content_type: content.content_type,
        data: pushData,
        user_id: target.user_id,
      });

      if (notificationId) {
        await this.pushRepository.createPushReceipt({
          notification_id: notificationId,
          user_id: target.user_id,
          push_token_id: target.push_token_id,
          expo_ticket_id: pushResult.ticketId || null,
          delivery_status: 'sent',
          sent_at: new Date().toISOString(),
        });
      }

      results.sent++;
      this.logger.debug(`Sent push to user ${target.user_id}: "${title}" - "${body}"`);
    } else {
      results.failed++;
      errors.push(`User ${target.user_id}: ${pushResult.error}`);
    }
  }

  /**
   * tagline 기반 푸시 메시지 생성
   * 스펙:
   * 1. tagline 있음 (≤20자) → Title: content_title, Body: tagline
   * 2. tagline 있음 (>20자) → Title: "이거 보셨어요?", Body: content_title
   * 3. tagline 없음 → Title: content_title, Body: 랜덤 문구
   */
  private generatePushMessage(
    content: RecommendedContent,
    userName: string,
  ): { title: string; body: string } {
    const tagline = content.tagline?.trim();

    // Case 1: tagline이 있고 20자 이하
    if (tagline && tagline.length <= MAX_TAGLINE_LENGTH) {
      return {
        title: content.title,
        body: tagline,
      };
    }

    // Case 2: tagline이 있지만 20자 초과
    if (tagline && tagline.length > MAX_TAGLINE_LENGTH) {
      return {
        title: '이거 보셨어요?',
        body: content.title,
      };
    }

    // Case 3: tagline이 없음 → 랜덤 문구
    const randomBody = this.getRandomBodyMessage(userName);
    return {
      title: content.title,
      body: randomBody,
    };
  }

  /**
   * 문구 풀에서 랜덤 Body 메시지 선택
   */
  private getRandomBodyMessage(userName: string): string {
    // 모든 카테고리에서 랜덤 선택
    const allMessages = [
      ...BODY_MESSAGE_POOL.curiosity,
      ...BODY_MESSAGE_POOL.casual,
      ...BODY_MESSAGE_POOL.contextual,
      ...BODY_MESSAGE_POOL.fomo,
      ...BODY_MESSAGE_POOL.minimal,
    ];

    const message = this.getRandomItem(allMessages);

    // {{user_name}} 치환
    return message.replace(/\{\{user_name\}\}/g, userName);
  }

  private getRandomItem<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }
}
