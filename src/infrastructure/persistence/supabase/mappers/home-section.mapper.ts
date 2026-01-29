import { HomeSection, SectionContentRef } from '@/domain/entities';
import { HomeSectionWithContents } from '@/domain/repositories';
import { ContentTypeValue } from '@/domain/value-objects';

/**
 * content_collections DB 레코드 타입
 */
export interface ContentCollectionDBRecord {
  id: string;
  title: string;
  subtitle?: string;
  theme_keywords?: string[];
  content_ids: Array<{ id: number; type: string }>;
  display_order: number;
  is_active: boolean;
  generated_at?: string;
  ai_reasoning?: string;
  created_at?: string;
}

/**
 * get_content_collections RPC 결과 타입
 */
export interface ContentCollectionRPCResult {
  collection_id: string;
  title: string;
  subtitle?: string;
  theme_keywords?: string[];
  display_order: number;
  generated_at?: string;
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
 * 콘텐츠 컬렉션 매퍼
 * DB 레코드와 도메인 엔티티 간 변환
 */
export class ContentCollectionMapper {
  /**
   * DB 레코드 -> 도메인 엔티티
   */
  static toDomain(record: ContentCollectionDBRecord): HomeSection {
    const contentIds: SectionContentRef[] = (record.content_ids || []).map((item) => ({
      id: item.id,
      type: item.type as ContentTypeValue,
    }));

    return HomeSection.reconstitute({
      id: record.id,
      title: record.title,
      subtitle: record.subtitle,
      themeKeywords: record.theme_keywords,
      contentIds,
      displayOrder: record.display_order,
      isActive: record.is_active,
      generatedAt: record.generated_at,
      aiReasoning: record.ai_reasoning,
    });
  }

  /**
   * 도메인 엔티티 -> DB 레코드 (Insert용)
   */
  static toPersistence(section: HomeSection): Omit<ContentCollectionDBRecord, 'id' | 'created_at'> {
    const props = section.toProps();
    return {
      title: props.title,
      subtitle: props.subtitle,
      theme_keywords: props.themeKeywords,
      content_ids: props.contentIds.map((c) => ({ id: c.id, type: c.type })),
      display_order: props.displayOrder,
      is_active: props.isActive ?? true,
      generated_at: props.generatedAt,
      ai_reasoning: props.aiReasoning,
    };
  }

  /**
   * RPC 결과 -> 응답 타입
   */
  static fromRPCResult(result: ContentCollectionRPCResult): HomeSectionWithContents {
    return {
      sectionId: result.collection_id,
      sectionTitle: result.title,
      sectionSubtitle: result.subtitle,
      themeKeywords: result.theme_keywords,
      displayOrder: result.display_order,
      generatedAt: result.generated_at,
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

// 기존 이름 호환성 유지
export { ContentCollectionMapper as HomeSectionMapper };
export type { ContentCollectionDBRecord as HomeSectionDBRecord };
export type { ContentCollectionRPCResult as HomeSectionRPCResult };
