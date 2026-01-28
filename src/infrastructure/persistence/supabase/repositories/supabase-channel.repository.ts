import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@/domain/entities';
import { IChannelRepository } from '@/domain/repositories';
import { ChannelMapper, ChannelDBRecord } from '../mappers';
import { SupabaseClientProvider } from '../supabase-client.provider';
import { SUPABASE_TABLES } from '../supabase-tables';

/**
 * Supabase 채널 리포지토리 구현체
 */
@Injectable()
export class SupabaseChannelRepository implements IChannelRepository {
  private readonly logger = new Logger(SupabaseChannelRepository.name);

  constructor(private readonly supabaseProvider: SupabaseClientProvider) {}

  async findAll(): Promise<Channel[]> {
    const { data, error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.CHANNELS)
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
    const { data, error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.CHANNELS)
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

    const { error } = await this.supabaseProvider.getClient().from(SUPABASE_TABLES.CHANNELS).upsert(
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
    const { data, error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.CHANNELS)
      .select('id')
      .eq('id', id)
      .single();

    return !error && !!data;
  }

  async getOrCreate(id: string, name: string): Promise<string> {
    const { data: existing } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.CHANNELS)
      .select('id')
      .eq('id', id)
      .single();

    if (existing) {
      return existing.id;
    }

    const { data: created, error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.CHANNELS)
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
