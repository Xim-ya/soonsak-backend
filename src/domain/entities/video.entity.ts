import { VideoId, TMDBId, ContentType, ContentTypeValue } from '../value-objects';

export interface VideoProps {
  id: string;
  contentId: number;
  contentType: ContentTypeValue;
  title: string;
  runtime?: number;
  thumbnailUrl?: string;
  isPrimary: boolean;
  channelId?: string;
  includesEnding: boolean;
  uploadedAt: string;
  updatedAt: string;
  youtubeViewCount?: number;
  youtubeLikeCount?: number;
}

/**
 * 비디오 도메인 엔티티
 */
export class Video {
  private readonly _id: VideoId;
  private readonly _contentId: TMDBId;
  private readonly _contentType: ContentType;
  private readonly _title: string;
  private readonly _runtime?: number;
  private readonly _thumbnailUrl?: string;
  private _isPrimary: boolean;
  private readonly _channelId?: string;
  private readonly _includesEnding: boolean;
  private readonly _uploadedAt: Date;
  private _updatedAt: Date;
  private readonly _youtubeViewCount?: number;
  private readonly _youtubeLikeCount?: number;

  private constructor(props: VideoProps) {
    this._id = VideoId.fromString(props.id);
    this._contentId = TMDBId.fromNumber(props.contentId);
    this._contentType = ContentType.fromString(props.contentType);
    this._title = props.title;
    this._runtime = props.runtime;
    this._thumbnailUrl = props.thumbnailUrl;
    this._isPrimary = props.isPrimary;
    this._channelId = props.channelId;
    this._includesEnding = props.includesEnding;
    this._uploadedAt = new Date(props.uploadedAt);
    this._updatedAt = new Date(props.updatedAt);
    this._youtubeViewCount = props.youtubeViewCount;
    this._youtubeLikeCount = props.youtubeLikeCount;
  }

  static create(props: VideoProps): Video {
    return new Video(props);
  }

  static reconstitute(props: VideoProps): Video {
    return new Video(props);
  }

  get id(): VideoId {
    return this._id;
  }

  get contentId(): TMDBId {
    return this._contentId;
  }

  get contentType(): ContentType {
    return this._contentType;
  }

  get title(): string {
    return this._title;
  }

  get runtime(): number | undefined {
    return this._runtime;
  }

  get thumbnailUrl(): string | undefined {
    return this._thumbnailUrl;
  }

  get isPrimary(): boolean {
    return this._isPrimary;
  }

  get channelId(): string | undefined {
    return this._channelId;
  }

  get includesEnding(): boolean {
    return this._includesEnding;
  }

  get uploadedAt(): Date {
    return this._uploadedAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get youtubeViewCount(): number | undefined {
    return this._youtubeViewCount;
  }

  get youtubeLikeCount(): number | undefined {
    return this._youtubeLikeCount;
  }

  markAsPrimary(): void {
    this._isPrimary = true;
    this._updatedAt = new Date();
  }

  unmarkAsPrimary(): void {
    this._isPrimary = false;
    this._updatedAt = new Date();
  }

  /**
   * 다른 비디오보다 Primary 우선순위가 높은지 확인
   */
  hasPriorityOver(other: Video): boolean {
    if (this._includesEnding && !other._includesEnding) {
      return true;
    }

    if (!this._includesEnding && other._includesEnding) {
      return false;
    }

    return (this._runtime ?? 0) > (other._runtime ?? 0);
  }

  toProps(): VideoProps {
    return {
      id: this._id.getValue(),
      contentId: this._contentId.getValue(),
      contentType: this._contentType.getValue(),
      title: this._title,
      runtime: this._runtime,
      thumbnailUrl: this._thumbnailUrl,
      isPrimary: this._isPrimary,
      channelId: this._channelId,
      includesEnding: this._includesEnding,
      uploadedAt: this._uploadedAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
      youtubeViewCount: this._youtubeViewCount,
      youtubeLikeCount: this._youtubeLikeCount,
    };
  }
}
