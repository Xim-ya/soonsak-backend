import { Injectable, Logger } from '@nestjs/common';
import { HomeSection } from '@/domain/entities';
import {
  IHomeSectionRepository,
  HomeSectionWithContents,
} from '@/domain/repositories';
import { PreviousSectionInfo } from '@/application/ports';
import {
  HomeSectionMapper,
  HomeSectionDBRecord,
  HomeSectionRPCResult,
} from '../mappers';
import { SupabaseClientProvider } from '../supabase-client.provider';
import { SUPABASE_TABLES } from '../supabase-tables';

/**
 * Supabase 홈 섹션 리포지토리 구현체
 */
@Injectable()
export class SupabaseHomeSectionRepository implements IHomeSectionRepository {
  private readonly logger = new Logger(SupabaseHomeSectionRepository.name);

  constructor(private readonly supabaseProvider: SupabaseClientProvider) {}

  async findAllActive(): Promise<HomeSection[]> {
    // is_active만으로 노출 여부 결정 (expires_at는 참고용)
    const { data: sections, error } = await this.supabaseProvider
      .getClient()
      .from(SUPABASE_TABLES.CONTENT_COLLECTIONS)
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      this.logger.error(`Failed to fetch active home sections: ${error.message}`);
      return [];
    }

    return (sections || []).map((section) =>
      HomeSectionMapper.toDomain(section as HomeSectionDBRecord),
    );
  }

  async findById(id: string): Promise<HomeSection | null> {
    const { data: section, error } = await this.supabaseProvider
      .getClient()
      .from(SUPABASE_TABLES.CONTENT_COLLECTIONS)
      .select('*')
      .eq('id', id)
      .single();

    if (error || !section) {
      return null;
    }

    return HomeSectionMapper.toDomain(section as HomeSectionDBRecord);
  }

  async save(section: HomeSection): Promise<string> {
    const record = HomeSectionMapper.toPersistence(section);

    const { data, error } = await this.supabaseProvider
      .getClient()
      .from(SUPABASE_TABLES.CONTENT_COLLECTIONS)
      .insert(record)
      .select('id')
      .single();

    if (error) {
      this.logger.error(`Failed to save home section: ${error.message}`);
      throw new Error(`Failed to save home section: ${error.message}`);
    }

    return data.id;
  }

  async saveAll(sections: HomeSection[]): Promise<string[]> {
    // 기존 활성 섹션 비활성화
    await this.deactivateAll();

    // 새 섹션들 저장
    const savedIds: string[] = [];
    for (const section of sections) {
      const id = await this.save(section);
      savedIds.push(id);
    }

    return savedIds;
  }

  async deactivateAll(): Promise<void> {
    const { error } = await this.supabaseProvider
      .getClient()
      .from(SUPABASE_TABLES.CONTENT_COLLECTIONS)
      .update({ is_active: false })
      .eq('is_active', true);

    if (error) {
      this.logger.error(`Failed to deactivate sections: ${error.message}`);
      throw new Error(`Failed to deactivate sections: ${error.message}`);
    }
  }

  async getHomeSectionsWithContents(): Promise<HomeSectionWithContents[]> {
    const { data, error } = await this.supabaseProvider
      .getClient()
      .rpc('get_content_collections');

    if (error) {
      this.logger.error(`Failed to get home sections via RPC: ${error.message}`);
      return [];
    }

    return (data || []).map((result: HomeSectionRPCResult) =>
      HomeSectionMapper.fromRPCResult(result),
    );
  }

  async findPreviousSections(limit: number = 30): Promise<PreviousSectionInfo[]> {
    const { data, error } = await this.supabaseProvider
      .getClient()
      .from(SUPABASE_TABLES.CONTENT_COLLECTIONS)
      .select('title, theme_keywords')
      .order('generated_at', { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error(`Failed to fetch previous sections: ${error.message}`);
      return [];
    }

    return (data || []).map((row) => ({
      title: row.title,
      themeKeywords: row.theme_keywords || [],
    }));
  }
}
