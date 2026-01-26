import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Video } from '@/domain/entities';
import { IVideoRepository } from '@/domain/repositories';
import { VideoId, TMDBId } from '@/domain/value-objects';
import { VideoMapper, VideoDBRecord } from '../mappers';

/**
 * Supabase 비디오 리포지토리 구현체
 */
@Injectable()
export class SupabaseVideoRepository implements IVideoRepository, OnModuleInit {
  private readonly logger = new Logger(SupabaseVideoRepository.name);
  private client: SupabaseClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('SUPABASE_URL');
    const key = this.configService.get<string>('SUPABASE_SERVICE_KEY');

    if (url && key) {
      this.client = createClient(url, key, {
        db: { schema: 'public' },
      });
      this.logger.log('SupabaseVideoRepository initialized');
    } else {
      this.logger.warn('SUPABASE_URL or SUPABASE_SERVICE_KEY not configured');
    }
  }

  private getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('Supabase client not initialized - check SUPABASE_URL and SUPABASE_SERVICE_KEY');
    }
    return this.client;
  }

  async exists(id: VideoId): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from('videos')
      .select('id')
      .eq('id', id.getValue())
      .single();

    return !error && !!data;
  }

  async findById(id: VideoId): Promise<Video | null> {
    const { data, error } = await this.getClient()
      .from('videos')
      .select('*')
      .eq('id', id.getValue())
      .single();

    if (error || !data) {
      return null;
    }

    return VideoMapper.toDomain(data as VideoDBRecord);
  }

  async findByContentId(contentId: TMDBId): Promise<Video[]> {
    const { data, error } = await this.getClient()
      .from('videos')
      .select('*')
      .eq('content_id', contentId.getValue());

    if (error || !data) {
      return [];
    }

    return data.map((record) => VideoMapper.toDomain(record as VideoDBRecord));
  }

  async save(video: Video): Promise<void> {
    const record = VideoMapper.toPersistence(video);

    const { error } = await this.getClient().from('videos').upsert(record, {
      onConflict: 'id',
    });

    if (error) {
      this.logger.error(`Failed to save video: ${error.message}`);
      throw new Error(`Failed to save video: ${error.message}`);
    }
  }

  async updatePrimaryStatus(id: VideoId, isPrimary: boolean): Promise<void> {
    const { error } = await this.getClient()
      .from('videos')
      .update({
        is_primary: isPrimary,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id.getValue());

    if (error) {
      this.logger.error(`Failed to update primary status: ${error.message}`);
      throw new Error(`Failed to update primary status: ${error.message}`);
    }
  }

  async findPrimaryByContentId(contentId: TMDBId): Promise<Video | null> {
    const { data, error } = await this.getClient()
      .from('videos')
      .select('*')
      .eq('content_id', contentId.getValue())
      .eq('is_primary', true)
      .single();

    if (error || !data) {
      return null;
    }

    return VideoMapper.toDomain(data as VideoDBRecord);
  }

  async getRecentVideoIds(channelId: string, limit = 50): Promise<string[]> {
    const { data, error } = await this.getClient()
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
}
