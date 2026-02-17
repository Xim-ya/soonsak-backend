import { Injectable, Logger } from '@nestjs/common';
import { Content } from '@/domain/entities';
import { IContentRepository } from '@/domain/repositories';
import { TMDBId } from '@/domain/value-objects';
import { ContentMapper, ContentDBRecord } from '../mappers';
import { SupabaseClientProvider } from '../supabase-client.provider';
import { SUPABASE_TABLES } from '../supabase-tables';

/**
 * Supabase 콘텐츠 리포지토리 구현체
 */
@Injectable()
export class SupabaseContentRepository implements IContentRepository {
  private readonly logger = new Logger(SupabaseContentRepository.name);

  constructor(private readonly supabaseProvider: SupabaseClientProvider) {}

  async findById(id: TMDBId): Promise<Content | null> {
    const { data, error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.CONTENTS)
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

    const { data, error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.CONTENTS)
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
    const { data, error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.CONTENTS)
      .select('id')
      .eq('id', id.getValue())
      .single();

    return !error && !!data;
  }

  async delete(id: TMDBId): Promise<void> {
    const { error } = await this.supabaseProvider.getClient()
      .from(SUPABASE_TABLES.CONTENTS)
      .delete()
      .eq('id', id.getValue());

    if (error) {
      this.logger.error(`Failed to delete content: ${error.message}`);
      throw new Error(`Failed to delete content: ${error.message}`);
    }
  }
}
