import { Injectable, Logger } from '@nestjs/common';
import { HomeSection } from '@/domain/entities';
import {
  IHomeSectionRepository,
  HomeSectionWithContents,
} from '@/domain/repositories';
import {
  HomeSectionMapper,
  HomeSectionItemMapper,
  HomeSectionDBRecord,
  HomeSectionItemDBRecord,
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
    const { data: sections, error } = await this.supabaseProvider
      .getClient()
      .from(SUPABASE_TABLES.HOME_SECTIONS)
      .select('*')
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('display_order', { ascending: true });

    if (error) {
      this.logger.error(`Failed to fetch active home sections: ${error.message}`);
      return [];
    }

    if (!sections || sections.length === 0) {
      return [];
    }

    // 각 섹션의 아이템 조회
    const sectionIds = sections.map((s) => s.id);
    const { data: items, error: itemsError } = await this.supabaseProvider
      .getClient()
      .from(SUPABASE_TABLES.HOME_SECTION_ITEMS)
      .select('*')
      .in('section_id', sectionIds)
      .order('display_order', { ascending: true });

    if (itemsError) {
      this.logger.warn(`Failed to fetch section items: ${itemsError.message}`);
    }

    // 섹션별 아이템 그룹핑
    const itemsBySectionId = (items || []).reduce(
      (acc, item) => {
        if (!acc[item.section_id]) {
          acc[item.section_id] = [];
        }
        acc[item.section_id].push(item as HomeSectionItemDBRecord);
        return acc;
      },
      {} as Record<string, HomeSectionItemDBRecord[]>,
    );

    return sections.map((section) =>
      HomeSectionMapper.toDomain(
        section as HomeSectionDBRecord,
        itemsBySectionId[section.id] || [],
      ),
    );
  }

  async findById(id: string): Promise<HomeSection | null> {
    const { data: section, error } = await this.supabaseProvider
      .getClient()
      .from(SUPABASE_TABLES.HOME_SECTIONS)
      .select('*')
      .eq('id', id)
      .single();

    if (error || !section) {
      return null;
    }

    const { data: items } = await this.supabaseProvider
      .getClient()
      .from(SUPABASE_TABLES.HOME_SECTION_ITEMS)
      .select('*')
      .eq('section_id', id)
      .order('display_order', { ascending: true });

    return HomeSectionMapper.toDomain(
      section as HomeSectionDBRecord,
      (items || []) as HomeSectionItemDBRecord[],
    );
  }

  async save(section: HomeSection): Promise<string> {
    const record = HomeSectionMapper.toPersistenceForInsert(section);

    const { data, error } = await this.supabaseProvider
      .getClient()
      .from(SUPABASE_TABLES.HOME_SECTIONS)
      .insert(record)
      .select('id')
      .single();

    if (error) {
      this.logger.error(`Failed to save home section: ${error.message}`);
      throw new Error(`Failed to save home section: ${error.message}`);
    }

    const sectionId = data.id;

    // 아이템 저장
    if (section.items.length > 0) {
      const itemRecords = section.items.map((item) =>
        HomeSectionItemMapper.toPersistenceForInsert(item, sectionId),
      );

      const { error: itemsError } = await this.supabaseProvider
        .getClient()
        .from(SUPABASE_TABLES.HOME_SECTION_ITEMS)
        .insert(itemRecords);

      if (itemsError) {
        this.logger.error(`Failed to save section items: ${itemsError.message}`);
        throw new Error(`Failed to save section items: ${itemsError.message}`);
      }
    }

    return sectionId;
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
      .from(SUPABASE_TABLES.HOME_SECTIONS)
      .update({ is_active: false })
      .eq('is_active', true);

    if (error) {
      this.logger.error(`Failed to deactivate sections: ${error.message}`);
      throw new Error(`Failed to deactivate sections: ${error.message}`);
    }
  }

  async cleanupExpired(): Promise<number> {
    const { data, error } = await this.supabaseProvider
      .getClient()
      .from(SUPABASE_TABLES.HOME_SECTIONS)
      .update({ is_active: false })
      .eq('is_active', true)
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) {
      this.logger.error(`Failed to cleanup expired sections: ${error.message}`);
      return 0;
    }

    return data?.length || 0;
  }

  async getHomeSectionsWithContents(): Promise<HomeSectionWithContents[]> {
    const { data, error } = await this.supabaseProvider
      .getClient()
      .rpc('get_home_sections');

    if (error) {
      this.logger.error(`Failed to get home sections via RPC: ${error.message}`);
      return [];
    }

    return (data || []).map((result: HomeSectionRPCResult) =>
      HomeSectionMapper.fromRPCResult(result),
    );
  }
}
