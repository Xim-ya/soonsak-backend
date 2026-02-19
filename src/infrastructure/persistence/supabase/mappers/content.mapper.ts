import { Content, ContentProps, PersonInfo } from '@/domain/entities';
import { ContentTypeValue, toLogoLanguage } from '@/domain/value-objects';

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
  overview?: string;
  uploaded_at?: string;
  // AI 분석용 메타데이터
  vote_average?: number;
  popularity?: number;
  origin_country?: string[];
  directors?: PersonInfo[];
  main_cast?: PersonInfo[];
  // 타이틀 로고
  title_logo?: string;
  title_logo_lang?: string;
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
      overview: record.overview,
      uploadedAt: record.uploaded_at,
      voteAverage: record.vote_average,
      popularity: record.popularity,
      originCountry: record.origin_country,
      directors: record.directors,
      mainCast: record.main_cast,
      titleLogo: record.title_logo,
      titleLogoLang: toLogoLanguage(record.title_logo_lang) ?? undefined,
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
      overview: props.overview || undefined,
      uploaded_at: props.uploadedAt,
      vote_average: props.voteAverage,
      popularity: props.popularity,
      origin_country: props.originCountry,
      directors: props.directors,
      main_cast: props.mainCast,
      title_logo: props.titleLogo || undefined,
      title_logo_lang: props.titleLogoLang || undefined,
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
      overview: props.overview || undefined,
      uploaded_at: props.uploadedAt,
      vote_average: props.voteAverage,
      popularity: props.popularity,
      origin_country: props.originCountry,
      directors: props.directors,
      main_cast: props.mainCast,
      title_logo: props.titleLogo || undefined,
      title_logo_lang: props.titleLogoLang || undefined,
    };
  }
}
