import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClientProvider } from '../supabase-client.provider';

export interface PushTarget {
  user_id: string;
  display_name: string | null;
  push_token: string;
  push_token_id: string;
  optimal_hour: number;
}

export interface RecommendedContent {
  content_id: number;
  content_type: string;
  title: string;
  tagline: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  recommendation_score: number;
}

export interface PushTemplate {
  id: string;
  title_template: string;
  body_template: string;
  body_variants: string[] | null;
  action_type: string;
}

export interface CreatePushNotificationInput {
  template_id: string | null;
  notification_type: string;
  title: string;
  body: string;
  action_type: string;
  content_id?: number;
  content_type?: string;
  data?: Record<string, unknown>;
  user_id: string;
}

export interface CreatePushReceiptInput {
  notification_id: string;
  user_id: string;
  push_token_id: string;
  expo_ticket_id: string | null;
  delivery_status: string;
  sent_at: string;
}

/**
 * 푸시 알림 관련 Supabase Repository
 */
@Injectable()
export class SupabasePushRepository {
  private readonly logger = new Logger(SupabasePushRepository.name);

  constructor(private readonly supabaseProvider: SupabaseClientProvider) {}

  /**
   * 현재 시간에 푸시를 받아야 할 사용자 목록 조회
   */
  async getPushTargetsForCurrentHour(currentHour: number): Promise<PushTarget[]> {
    const client = this.supabaseProvider.getClient();

    const { data, error } = await client.rpc('get_push_targets_for_current_hour', {
      p_current_hour: currentHour,
    });

    if (error) {
      this.logger.error(`Failed to get push targets: ${error.message}`);
      throw new Error(`Failed to get push targets: ${error.message}`);
    }

    return data || [];
  }

  /**
   * 사용자별 추천 콘텐츠 조회
   */
  async getRecommendedContentForUser(
    userId: string,
    limit: number = 1,
  ): Promise<RecommendedContent[]> {
    const client = this.supabaseProvider.getClient();

    const { data, error } = await client.rpc('get_recommended_content_for_user', {
      p_user_id: userId,
      p_limit: limit,
    });

    if (error) {
      this.logger.error(`Failed to get recommendations for user ${userId}: ${error.message}`);
      return [];
    }

    return data || [];
  }

  /**
   * 푸시 템플릿 조회
   */
  async getActiveTemplate(templateName: string): Promise<PushTemplate | null> {
    const client = this.supabaseProvider.getClient();

    const { data, error } = await client
      .from('push_notification_templates')
      .select('id, title_template, body_template, body_variants, action_type')
      .eq('name', templateName)
      .eq('is_active', true)
      .single();

    if (error) {
      this.logger.error(`Failed to get template: ${error.message}`);
      return null;
    }

    return data;
  }

  /**
   * 푸시 알림 기록 생성
   */
  async createPushNotification(input: CreatePushNotificationInput): Promise<string | null> {
    const client = this.supabaseProvider.getClient();

    const { data, error } = await client
      .from('push_notifications')
      .insert({
        template_id: input.template_id,
        notification_type: input.notification_type,
        title: input.title,
        body: input.body,
        action_type: input.action_type,
        content_id: input.content_id,
        content_type: input.content_type,
        data: input.data,
        user_id: input.user_id,
      })
      .select('id')
      .single();

    if (error) {
      this.logger.error(`Failed to create notification: ${error.message}`);
      return null;
    }

    return data?.id || null;
  }

  /**
   * 푸시 발송 내역 기록
   */
  async createPushReceipt(input: CreatePushReceiptInput): Promise<void> {
    const client = this.supabaseProvider.getClient();

    const { error } = await client.from('push_notification_receipts').insert({
      notification_id: input.notification_id,
      user_id: input.user_id,
      push_token_id: input.push_token_id,
      expo_ticket_id: input.expo_ticket_id,
      delivery_status: input.delivery_status,
      sent_at: input.sent_at,
    });

    if (error) {
      this.logger.error(`Failed to create receipt: ${error.message}`);
    }
  }

  /**
   * 템플릿 마지막 실행 시간 업데이트
   */
  async updateTemplateLastRunAt(templateId: string): Promise<void> {
    const client = this.supabaseProvider.getClient();

    const { error } = await client
      .from('push_notification_templates')
      .update({ last_run_at: new Date().toISOString() })
      .eq('id', templateId);

    if (error) {
      this.logger.error(`Failed to update template last_run_at: ${error.message}`);
    }
  }

  /**
   * 강제 모드: 2일 조건 무시하고 모든 eligible 사용자 조회
   */
  async getAllPushTargetsForHour(currentHour: number): Promise<PushTarget[]> {
    const client = this.supabaseProvider.getClient();

    // RPC 함수 대신 직접 쿼리로 2일 조건 없이 조회
    const { data, error } = await client.rpc('get_push_targets_force_mode', {
      p_current_hour: currentHour,
    });

    if (error) {
      // fallback: force mode RPC가 없으면 기본 RPC 사용
      this.logger.warn(`Force mode RPC not found, using regular query: ${error.message}`);
      return this.getPushTargetsForCurrentHour(currentHour);
    }

    return data || [];
  }
}
