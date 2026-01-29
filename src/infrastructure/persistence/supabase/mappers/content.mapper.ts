import { Content, ContentProps } from '@/domain/entities';
import { ContentTypeValue } from '@/domain/value-objects';

/**
 * 콘텐츠 DB 레코드 타입
 */
export interface ContentDBRecord {
  id: number;
  content_type: string;
  title: string;
  poster_path?: string;
  backdrop_path?: string;
  release_date?: string;
  genre_ids?: number[];
  original_language?: string;
  tagline?: string;
  uploaded_at?: string;
}

/**
 * 콘텐츠 매퍼
 * DB 레코드와 도메인 엔티티 간 변환
 */
export class ContentMapper {
  /**
   * DB 레코드 -> 도메인 엔티티
   */
  static toDomain(record: ContentDBRecord): Content {
    return Content.reconstitute({
      id: record.id,
      contentType: record.content_type as ContentTypeValue,
      title: record.title,
      posterPath: record.poster_path,
      backdropPath: record.backdrop_path,
      releaseDate: record.release_date,
      genreIds: record.genre_ids,
      originalLanguage: record.original_language,
      tagline: record.tagline,
      uploadedAt: record.uploaded_at,
    });
  }

  /**
   * 도메인 엔티티 -> DB 레코드
   */
  static toPersistence(content: Content): ContentDBRecord {
    const props = content.toProps();
    return {
      id: props.id,
      content_type: props.contentType,
      title: props.title,
      poster_path: props.posterPath || undefined,
      backdrop_path: props.backdropPath || undefined,
      release_date: props.releaseDate || undefined,
      genre_ids: props.genreIds,
      original_language: props.originalLanguage || undefined,
      tagline: props.tagline || undefined,
      uploaded_at: props.uploadedAt,
    };
  }

  /**
   * ContentProps -> DB 레코드
   */
  static propsToRecord(props: ContentProps): ContentDBRecord {
    return {
      id: props.id,
      content_type: props.contentType,
      title: props.title,
      poster_path: props.posterPath || undefined,
      backdrop_path: props.backdropPath || undefined,
      release_date: props.releaseDate || undefined,
      genre_ids: props.genreIds,
      original_language: props.originalLanguage || undefined,
      tagline: props.tagline || undefined,
      uploaded_at: props.uploadedAt,
    };
  }
}
