import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Content } from '@/domain/entities';
import { IContentRepository } from '@/domain/repositories';
import { TMDBId } from '@/domain/value-objects';
import { ContentMapper, ContentDBRecord } from '../mappers';

/**
 * Supabase 콘텐츠 리포지토리 구현체
 */
@Injectable()
export class SupabaseContentRepository implements IContentRepository, OnModuleInit {
  private readonly logger = new Logger(SupabaseContentRepository.name);
  private client: SupabaseClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('SUPABASE_URL');
    const key = this.configService.get<string>('SUPABASE_SERVICE_KEY');

    if (url && key) {
      this.client = createClient(url, key, {
        db: { schema: 'public' },
      });
      this.logger.log('SupabaseContentRepository initialized');
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

  async findById(id: TMDBId): Promise<Content | null> {
    const { data, error } = await this.getClient()
      .from('contents')
      .select('*')
      .eq('id', id.getValue())
      .single();

    if (error || !data) {
      return null;
    }

    return ContentMapper.toDomain(data as ContentDBRecord);
  }

  async save(content: Content): Promise<number> {
    const existingContent = await this.findById(content.id);
    if (existingContent) {
      return existingContent.id.getValue();
    }

    const record = ContentMapper.toPersistence(content);

    const { data, error } = await this.getClient()
      .from('contents')
      .insert({
        ...record,
        uploaded_at: record.uploaded_at || new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      this.logger.error(`Failed to save content: ${error.message}`);
      throw new Error(`Failed to save content: ${error.message}`);
    }

    return data.id;
  }

  async exists(id: TMDBId): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from('contents')
      .select('id')
      .eq('id', id.getValue())
      .single();

    return !error && !!data;
  }
}
