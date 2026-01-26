import { Channel, ChannelProps } from '@/domain/entities';

/**
 * 채널 DB 레코드 타입
 */
export interface ChannelDBRecord {
  id: string;
  name: string;
  handle_id: string;
  logo_url?: string;
  banner_url?: string;
  subscriber_count?: number;
  updated_at?: string;
}

/**
 * 채널 매퍼
 * DB 레코드와 도메인 엔티티 간 변환
 */
export class ChannelMapper {
  /**
   * DB 레코드 -> 도메인 엔티티
   */
  static toDomain(record: ChannelDBRecord): Channel {
    return Channel.reconstitute({
      id: record.id,
      name: record.name,
      handleId: record.handle_id,
      logoUrl: record.logo_url,
      lastProcessedAt: record.updated_at ? new Date(record.updated_at) : undefined,
    });
  }

  /**
   * 도메인 엔티티 -> DB 레코드
   */
  static toPersistence(channel: Channel): ChannelDBRecord {
    const props = channel.toProps();
    return {
      id: props.id,
      name: props.name,
      handle_id: props.handleId,
      logo_url: props.logoUrl,
      updated_at: props.lastProcessedAt?.toISOString(),
    };
  }

  /**
   * ChannelProps -> DB 레코드
   */
  static propsToRecord(props: ChannelProps): ChannelDBRecord {
    return {
      id: props.id,
      name: props.name,
      handle_id: props.handleId,
      logo_url: props.logoUrl,
      updated_at: props.lastProcessedAt?.toISOString(),
    };
  }
}
