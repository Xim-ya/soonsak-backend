import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  ChannelEntity,
  VideoEntity,
  ContentEntity,
  YouTubeChannelInfo,
  ContentType,
} from '@/common/types';
import { DatabaseException } from '@/common/exceptions';

/**
 * Supabase 데이터베이스 서비스
 * NestJS 의존성 주입을 통한 설정 관리
 */
@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);
  private client: SupabaseClient;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.getOrThrow<string>('SUPABASE_URL');
    const key = this.configService.getOrThrow<string>('SUPABASE_SERVICE_KEY');

    this.client = createClient(url, key, {
      db: { schema: 'public' },
    });

    this.logger.log('Supabase client initialized');
  }

  // ============ 채널 관련 작업 ============

  async getAllChannels(): Promise<ChannelEntity[]> {
    const { data, error } = await this.client
      .from('channels')
      .select('id, name, handle_id, logo_url')
      .order('name');

    if (error) {
      throw DatabaseException.operationFailed('getAllChannels', new Error(error.message));
    }

    return (data || []).map((row) => ({
      id: row.id,
      name: row.name,
      handleId: row.handle_id,
      logoUrl: row.logo_url,
    }));
  }

  async getOrCreateChannel(channelId: string, channelName?: string): Promise<string> {
    const { data: existing } = await this.client
      .from('channels')
      .select('id')
      .eq('id', channelId)
      .single();

    if (existing) {
      return existing.id;
    }

    const { data: created, error } = await this.client
      .from('channels')
      .upsert({
        id: channelId,
        name: channelName || 'Unknown Channel',
        handle_id: channelId,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      this.logger.warn(`Channel creation failed: ${error.message}`);
      return channelId;
    }

    return created.id;
  }

  async upsertChannel(channelInfo: YouTubeChannelInfo): Promise<void> {
    const { error } = await this.client.from('channels').upsert(
      {
        id: channelInfo.id,
        name: channelInfo.name,
        handle_id: channelInfo.handleId,
        logo_url: channelInfo.logoUrl,
        banner_url: channelInfo.bannerUrl,
        subscriber_count: channelInfo.subscriberCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );

    if (error) {
      throw DatabaseException.operationFailed('upsertChannel', new Error(error.message));
    }
  }

  // ============ 비디오 관련 작업 ============

  async videoExists(videoId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('videos')
      .select('id')
      .eq('id', videoId)
      .single();

    return !error && !!data;
  }

  async upsertVideo(video: VideoEntity): Promise<void> {
    const { error } = await this.client.from('videos').upsert(
      {
        id: video.id,
        content_id: video.contentId,
        content_type: video.contentType,
        title: video.title,
        runtime: video.runtime,
        thumbnail_url: video.thumbnailUrl,
        is_primary: video.isPrimary,
        channel_id: video.channelId,
        includes_ending: video.includesEnding,
        uploaded_at: video.uploadedAt,
        updated_at: video.updatedAt,
      },
      { onConflict: 'id' },
    );

    if (error) {
      throw DatabaseException.operationFailed('upsertVideo', new Error(error.message));
    }
  }

  async getVideosByContentId(contentId: number): Promise<
    Array<{
      id: string;
      runtime: number;
      isPrimary: boolean;
      includesEnding: boolean;
    }>
  > {
    const { data, error } = await this.client
      .from('videos')
      .select('id, runtime, is_primary, includes_ending')
      .eq('content_id', contentId);

    if (error || !data) {
      return [];
    }

    return data.map((row) => ({
      id: row.id,
      runtime: row.runtime,
      isPrimary: row.is_primary,
      includesEnding: row.includes_ending,
    }));
  }

  async updateVideoPrimary(videoId: string, isPrimary: boolean): Promise<void> {
    const { error } = await this.client
      .from('videos')
      .update({
        is_primary: isPrimary,
        updated_at: new Date().toISOString(),
      })
      .eq('id', videoId);

    if (error) {
      throw DatabaseException.operationFailed('updateVideoPrimary', new Error(error.message));
    }
  }

  async getRecentVideoIds(channelId: string, limit = 50): Promise<string[]> {
    const { data, error } = await this.client
      .from('videos')
      .select('id')
      .eq('channel_id', channelId)
      .order('uploaded_at', { ascending: false })
      .limit(limit);

    if (error) {
      return [];
    }

    return (data || []).map((row) => row.id);
  }

  // ============ 콘텐츠 관련 작업 ============

  async upsertContent(content: ContentEntity): Promise<number> {
    const existing = await this.getContentByTmdbId(content.id);
    if (existing) {
      return existing.id;
    }

    const { data, error } = await this.client
      .from('contents')
      .insert({
        id: content.id,
        content_type: content.contentType,
        title: content.title,
        poster_path: content.posterPath,
        uploaded_at: content.uploadedAt || new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      throw DatabaseException.operationFailed(
        `upsertContent: ${error.message}`,
        new Error(error.message),
      );
    }

    return data.id;
  }

  async getContentByTmdbId(tmdbId: number): Promise<ContentEntity | null> {
    const { data, error } = await this.client
      .from('contents')
      .select('id, content_type, title, poster_path, uploaded_at')
      .eq('id', tmdbId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      contentType: data.content_type as ContentType,
      title: data.title,
      posterPath: data.poster_path,
      uploadedAt: data.uploaded_at,
    };
  }
}
