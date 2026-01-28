import { TMDBId, ContentType, ContentTypeValue } from '../value-objects';

export interface ContentProps {
  id: number;
  contentType: ContentTypeValue;
  title: string;
  posterPath?: string;
  backdropPath?: string;
  releaseDate?: string;
  genreIds?: number[];
  originalLanguage?: string;
  tagline?: string;
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
  private readonly _backdropPath?: string;
  private readonly _releaseDate?: string;
  private readonly _genreIds?: number[];
  private readonly _originalLanguage?: string;
  private readonly _tagline?: string;
  private readonly _uploadedAt?: Date;

  private constructor(props: ContentProps) {
    this._id = TMDBId.fromNumber(props.id);
    this._contentType = ContentType.fromString(props.contentType);
    this._title = props.title;
    this._posterPath = props.posterPath;
    this._backdropPath = props.backdropPath;
    this._releaseDate = props.releaseDate;
    this._genreIds = props.genreIds;
    this._originalLanguage = props.originalLanguage;
    this._tagline = props.tagline;
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

  get backdropPath(): string | undefined {
    return this._backdropPath;
  }

  get releaseDate(): string | undefined {
    return this._releaseDate;
  }

  get genreIds(): number[] | undefined {
    return this._genreIds;
  }

  get originalLanguage(): string | undefined {
    return this._originalLanguage;
  }

  get tagline(): string | undefined {
    return this._tagline;
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
      backdropPath: this._backdropPath,
      releaseDate: this._releaseDate,
      genreIds: this._genreIds,
      originalLanguage: this._originalLanguage,
      tagline: this._tagline,
      uploadedAt: this._uploadedAt?.toISOString(),
    };
  }
}
