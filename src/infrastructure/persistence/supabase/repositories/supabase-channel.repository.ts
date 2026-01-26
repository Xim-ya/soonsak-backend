import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Channel } from '@/domain/entities';
import { IChannelRepository } from '@/domain/repositories';
import { ChannelMapper, ChannelDBRecord } from '../mappers';

/**
 * Supabase 채널 리포지토리 구현체
 */
@Injectable()
export class SupabaseChannelRepository implements IChannelRepository, OnModuleInit {
  private readonly logger = new Logger(SupabaseChannelRepository.name);
  private client: SupabaseClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('SUPABASE_URL');
    const key = this.configService.get<string>('SUPABASE_SERVICE_KEY');

    if (url && key) {
      this.client = createClient(url, key, {
        db: { schema: 'public' },
      });
      this.logger.log('SupabaseChannelRepository initialized');
    } else {
      this.logger.warn('SUPABASE_URL or SUPABASE_SERVICE_KEY not configured');
    }
  }

  private getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('Supabase client not initialized');
    }
    return this.client;
  }

  async findAll(): Promise<Channel[]> {
    const { data, error } = await this.getClient()
      .from('channels')
      .select('id, name, handle_id, logo_url')
      .order('name');

    if (error) {
      this.logger.error(`Failed to get all channels: ${error.message}`);
      throw new Error(`Failed to get all channels: ${error.message}`);
    }

    return (data || []).map((record) =>
      ChannelMapper.toDomain(record as ChannelDBRecord),
    );
  }

  async findById(id: string): Promise<Channel | null> {
    const { data, error } = await this.getClient()
      .from('channels')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return null;
    }

    return ChannelMapper.toDomain(data as ChannelDBRecord);
  }

  async save(channel: Channel): Promise<void> {
    const record = ChannelMapper.toPersistence(channel);

    const { error } = await this.getClient().from('channels').upsert(
      {
        ...record,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );

    if (error) {
      this.logger.error(`Failed to save channel: ${error.message}`);
      throw new Error(`Failed to save channel: ${error.message}`);
    }
  }

  async exists(id: string): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from('channels')
      .select('id')
      .eq('id', id)
      .single();

    return !error && !!data;
  }

  async getOrCreate(id: string, name: string): Promise<string> {
    const { data: existing } = await this.getClient()
      .from('channels')
      .select('id')
      .eq('id', id)
      .single();

    if (existing) {
      return existing.id;
    }

    const { data: created, error } = await this.getClient()
      .from('channels')
      .upsert({
        id,
        name: name || 'Unknown Channel',
        handle_id: id,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      this.logger.warn(`Channel creation failed: ${error.message}`);
      return id;
    }

    return created.id;
  }
}
