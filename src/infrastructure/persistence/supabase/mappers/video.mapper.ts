import { Video, VideoProps } from '@/domain/entities';
import { ContentTypeValue } from '@/domain/value-objects';

/**
 * 비디오 DB 레코드 타입
 */
export interface VideoDBRecord {
  id: string;
  content_id: number;
  content_type: string;
  title: string;
  runtime?: number;
  thumbnail_url?: string;
  is_primary: boolean;
  channel_id?: string;
  includes_ending: boolean;
  uploaded_at: string;
  updated_at: string;
}

/**
 * 비디오 매퍼
 * DB 레코드와 도메인 엔티티 간 변환
 */
export class VideoMapper {
  /**
   * DB 레코드 -> 도메인 엔티티
   */
  static toDomain(record: VideoDBRecord): Video {
    return Video.reconstitute({
      id: record.id,
      contentId: record.content_id,
      contentType: record.content_type as ContentTypeValue,
      title: record.title,
      runtime: record.runtime,
      thumbnailUrl: record.thumbnail_url,
      isPrimary: record.is_primary,
      channelId: record.channel_id,
      includesEnding: record.includes_ending,
      uploadedAt: record.uploaded_at,
      updatedAt: record.updated_at,
    });
  }

  /**
   * 도메인 엔티티 -> DB 레코드
   */
  static toPersistence(video: Video): VideoDBRecord {
    const props = video.toProps();
    return {
      id: props.id,
      content_id: props.contentId,
      content_type: props.contentType,
      title: props.title,
      runtime: props.runtime,
      thumbnail_url: props.thumbnailUrl,
      is_primary: props.isPrimary,
      channel_id: props.channelId,
      includes_ending: props.includesEnding,
      uploaded_at: props.uploadedAt,
      updated_at: props.updatedAt,
    };
  }

  /**
   * VideoProps -> DB 레코드
   */
  static propsToRecord(props: VideoProps): VideoDBRecord {
    return {
      id: props.id,
      content_id: props.contentId,
      content_type: props.contentType,
      title: props.title,
      runtime: props.runtime,
      thumbnail_url: props.thumbnailUrl,
      is_primary: props.isPrimary,
      channel_id: props.channelId,
      includes_ending: props.includesEnding,
      uploaded_at: props.uploadedAt,
      updated_at: props.updatedAt,
    };
  }
}
