import { TMDBId, ContentType, ContentTypeValue } from '../value-objects';

export interface ContentProps {
  id: number;
  contentType: ContentTypeValue;
  title: string;
  posterPath?: string;
  uploadedAt?: string;
}

/**
 * 콘텐츠 도메인 엔티티 (TMDB 정보)
 */
export class Content {
  private readonly _id: TMDBId;
  private readonly _contentType: ContentType;
  private readonly _title: string;
  private readonly _posterPath?: string;
  private readonly _uploadedAt?: Date;

  private constructor(props: ContentProps) {
    this._id = TMDBId.fromNumber(props.id);
    this._contentType = ContentType.fromString(props.contentType);
    this._title = props.title;
    this._posterPath = props.posterPath;
    this._uploadedAt = props.uploadedAt ? new Date(props.uploadedAt) : undefined;
  }

  static create(props: ContentProps): Content {
    return new Content(props);
  }

  static reconstitute(props: ContentProps): Content {
    return new Content(props);
  }

  get id(): TMDBId {
    return this._id;
  }

  get contentType(): ContentType {
    return this._contentType;
  }

  get title(): string {
    return this._title;
  }

  get posterPath(): string | undefined {
    return this._posterPath;
  }

  get uploadedAt(): Date | undefined {
    return this._uploadedAt;
  }

  toProps(): ContentProps {
    return {
      id: this._id.getValue(),
      contentType: this._contentType.getValue(),
      title: this._title,
      posterPath: this._posterPath,
      uploadedAt: this._uploadedAt?.toISOString(),
    };
  }
}
