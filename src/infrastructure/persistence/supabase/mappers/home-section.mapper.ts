import {
  HomeSection,
  HomeSectionProps,
  HomeSectionItem,
  HomeSectionItemProps,
} from '@/domain/entities';
import { ContentTypeValue } from '@/domain/value-objects';
import { HomeSectionWithContents } from '@/domain/repositories';

/**
 * home_sections DB 레코드 타입
 */
export interface HomeSectionDBRecord {
  id: string;
  title: string;
  subtitle?: string;
  theme_keywords?: string[];
  display_order: number;
  is_active: boolean;
  generated_at?: string;
  expires_at?: string;
  ai_reasoning?: string;
  created_at?: string;
}

/**
 * home_section_items DB 레코드 타입
 */
export interface HomeSectionItemDBRecord {
  id: string;
  section_id: string;
  content_id: number;
  content_type: string;
  display_order: number;
  created_at?: string;
}

/**
 * get_home_sections RPC 결과 타입
 */
export interface HomeSectionRPCResult {
  section_id: string;
  section_title: string;
  section_subtitle?: string;
  theme_keywords?: string[];
  display_order: number;
  generated_at?: string;
  expires_at?: string;
  contents: Array<{
    id: number;
    content_type: string;
    title: string;
    poster_path?: string;
    backdrop_path?: string;
    tagline?: string;
    overview?: string;
    release_date?: string;
    genre_ids?: number[];
  }>;
}

/**
 * 홈 섹션 매퍼
 * DB 레코드와 도메인 엔티티 간 변환
 */
export class HomeSectionMapper {
  /**
   * DB 레코드 -> 도메인 엔티티 (섹션만)
   */
  static toDomain(
    record: HomeSectionDBRecord,
    itemRecords?: HomeSectionItemDBRecord[],
  ): HomeSection {
    const items = (itemRecords || []).map((item) =>
      HomeSectionItemMapper.toDomain(item),
    );

    return HomeSection.reconstitute({
      id: record.id,
      title: record.title,
      subtitle: record.subtitle,
      themeKeywords: record.theme_keywords,
      displayOrder: record.display_order,
      isActive: record.is_active,
      generatedAt: record.generated_at,
      expiresAt: record.expires_at,
      aiReasoning: record.ai_reasoning,
      items: items.map((item) => item.toProps()),
    });
  }

  /**
   * 도메인 엔티티 -> DB 레코드 (섹션만)
   */
  static toPersistence(section: HomeSection): HomeSectionDBRecord {
    const props = section.toProps();
    return {
      id: props.id || '',
      title: props.title,
      subtitle: props.subtitle,
      theme_keywords: props.themeKeywords,
      display_order: props.displayOrder,
      is_active: props.isActive ?? true,
      generated_at: props.generatedAt,
      expires_at: props.expiresAt,
      ai_reasoning: props.aiReasoning,
    };
  }

  /**
   * 도메인 엔티티 -> DB 레코드 (Insert용, ID 제외)
   */
  static toPersistenceForInsert(
    section: HomeSection,
  ): Omit<HomeSectionDBRecord, 'id'> {
    const props = section.toProps();
    return {
      title: props.title,
      subtitle: props.subtitle,
      theme_keywords: props.themeKeywords,
      display_order: props.displayOrder,
      is_active: props.isActive ?? true,
      generated_at: props.generatedAt,
      expires_at: props.expiresAt,
      ai_reasoning: props.aiReasoning,
    };
  }

  /**
   * RPC 결과 -> 응답 타입
   */
  static fromRPCResult(result: HomeSectionRPCResult): HomeSectionWithContents {
    return {
      sectionId: result.section_id,
      sectionTitle: result.section_title,
      sectionSubtitle: result.section_subtitle,
      themeKeywords: result.theme_keywords,
      displayOrder: result.display_order,
      generatedAt: result.generated_at,
      expiresAt: result.expires_at,
      contents: (result.contents || []).map((c) => ({
        id: c.id,
        contentType: c.content_type,
        title: c.title,
        posterPath: c.poster_path,
        backdropPath: c.backdrop_path,
        tagline: c.tagline,
        overview: c.overview,
        releaseDate: c.release_date,
        genreIds: c.genre_ids,
      })),
    };
  }
}

/**
 * 홈 섹션 아이템 매퍼
 */
export class HomeSectionItemMapper {
  /**
   * DB 레코드 -> 도메인 엔티티
   */
  static toDomain(record: HomeSectionItemDBRecord): HomeSectionItem {
    return HomeSectionItem.reconstitute({
      id: record.id,
      sectionId: record.section_id,
      contentId: record.content_id,
      contentType: record.content_type as ContentTypeValue,
      displayOrder: record.display_order,
    });
  }

  /**
   * 도메인 엔티티 -> DB 레코드
   */
  static toPersistence(item: HomeSectionItem): HomeSectionItemDBRecord {
    const props = item.toProps();
    return {
      id: props.id || '',
      section_id: props.sectionId,
      content_id: props.contentId,
      content_type: props.contentType,
      display_order: props.displayOrder,
    };
  }

  /**
   * 도메인 엔티티 -> DB 레코드 (Insert용, ID 제외)
   */
  static toPersistenceForInsert(
    item: HomeSectionItem,
    sectionId: string,
  ): Omit<HomeSectionItemDBRecord, 'id'> {
    const props = item.toProps();
    return {
      section_id: sectionId,
      content_id: props.contentId,
      content_type: props.contentType,
      display_order: props.displayOrder,
    };
  }
}
