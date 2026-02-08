import { Injectable, Logger } from '@nestjs/common';
import { FailedVideo } from '@/domain/entities/failed-video.entity';
import { IFailedVideoRepository } from '@/domain/repositories/failed-video.repository.interface';
import { SupabaseClientProvider } from '../supabase-client.provider';
import { SUPABASE_TABLES } from '../supabase-tables';

/**
 * 실패 비디오 DB 레코드 타입
 */
interface FailedVideoDBRecord {
  id: string;
  video_id: string;
  title: string;
  channel_id: string | null;
  failure_reason: string;
  retry_count: number;
  is_permanently_failed: boolean;
  last_attempted_at: string;
  created_at: string;
}

/**
 * Supabase 실패 비디오 리포지토리 구현체
 */
@Injectable()
export class SupabaseFailedVideoRepository implements IFailedVideoRepository {
  private readonly logger = new Logger(SupabaseFailedVideoRepository.name);

  constructor(private readonly supabaseProvider: SupabaseClientProvider) {}

  async findByVideoId(videoId: string): Promise<FailedVideo | null> {
    const { data, error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.FAILED_VIDEOS)
      .select('*')
      .eq('video_id', videoId)
      .single();

    if (error || !data) {
      return null;
    }

    return this.toDomain(data as FailedVideoDBRecord);
  }

  async findRetryable(): Promise<FailedVideo[]> {
    const { data, error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.FAILED_VIDEOS)
      .select('*')
      .eq('is_permanently_failed', false)
      .lt('retry_count', 3)
      .order('last_attempted_at', { ascending: true });

    if (error || !data) {
      return [];
    }

    return data.map((record) => this.toDomain(record as FailedVideoDBRecord));
  }

  async findPermanentlyFailedIds(): Promise<string[]> {
    const { data, error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.FAILED_VIDEOS)
      .select('video_id')
      .eq('is_permanently_failed', true);

    if (error || !data) {
      return [];
    }

    return data.map((row) => row.video_id);
  }

  async save(failedVideo: FailedVideo): Promise<void> {
    const record = this.toPersistence(failedVideo);

    const { error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.FAILED_VIDEOS)
      .upsert(record, {
        onConflict: 'video_id',
      });

    if (error) {
      this.logger.error(`Failed to save failed video: ${error.message}`);
      throw new Error(`Failed to save failed video: ${error.message}`);
    }
  }

  async deleteByVideoId(videoId: string): Promise<void> {
    const { error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.FAILED_VIDEOS)
      .delete()
      .eq('video_id', videoId);

    if (error) {
      this.logger.error(`Failed to delete failed video: ${error.message}`);
      throw new Error(`Failed to delete failed video: ${error.message}`);
    }
  }

  async isPermanentlyFailed(videoId: string): Promise<boolean> {
    const { data, error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.FAILED_VIDEOS)
      .select('is_permanently_failed')
      .eq('video_id', videoId)
      .eq('is_permanently_failed', true)
      .single();

    return !error && !!data;
  }

  async filterPermanentlyFailed(videoIds: string[]): Promise<string[]> {
    if (videoIds.length === 0) {
      return [];
    }

    const { data, error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.FAILED_VIDEOS)
      .select('video_id')
      .in('video_id', videoIds)
      .eq('is_permanently_failed', true);

    if (error || !data) {
      return [];
    }

    return data.map((row) => row.video_id);
  }

  async findRecentFailures(limit = 20): Promise<FailedVideo[]> {
    const { data, error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.FAILED_VIDEOS)
      .select('*')
      .order('last_attempted_at', { ascending: false })
      .limit(limit);

    if (error || !data) {
      return [];
    }

    return data.map((record) => this.toDomain(record as FailedVideoDBRecord));
  }

  private toDomain(record: FailedVideoDBRecord): FailedVideo {
    return FailedVideo.fromPersistence({
      id: record.id,
      videoId: record.video_id,
      title: record.title,
      channelId: record.channel_id || undefined,
      failureReason: record.failure_reason,
      retryCount: record.retry_count,
      isPermanentlyFailed: record.is_permanently_failed,
      lastAttemptedAt: new Date(record.last_attempted_at),
      createdAt: new Date(record.created_at),
    });
  }

  private toPersistence(failedVideo: FailedVideo): Omit<FailedVideoDBRecord, 'id'> & { id?: string } {
    return {
      ...(failedVideo.id ? { id: failedVideo.id } : {}),
      video_id: failedVideo.videoId,
      title: failedVideo.title,
      channel_id: failedVideo.channelId || null,
      failure_reason: failedVideo.failureReason,
      retry_count: failedVideo.retryCount,
      is_permanently_failed: failedVideo.isPermanentlyFailed,
      last_attempted_at: failedVideo.lastAttemptedAt.toISOString(),
      created_at: failedVideo.createdAt.toISOString(),
    };
  }
}
