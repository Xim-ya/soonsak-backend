import { TMDBId, ContentType, ContentTypeValue, LogoLanguage } from '../value-objects';

/**
 * 인물 정보 (감독/배우)
 */
export interface PersonInfo {
  id: number;
  name: string;
}

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
  overview?: string;
  uploadedAt?: string;
  // AI 분석용 메타데이터
  voteAverage?: number;
  popularity?: number;
  originCountry?: string[];
  directors?: PersonInfo[];
  mainCast?: PersonInfo[];
  // 타이틀 로고
  titleLogo?: string;
  titleLogoLang?: LogoLanguage;
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
  private readonly _overview?: string;
  private readonly _uploadedAt?: Date;
  // AI 분석용 메타데이터
  private readonly _voteAverage?: number;
  private readonly _popularity?: number;
  private readonly _originCountry?: string[];
  private readonly _directors?: PersonInfo[];
  private readonly _mainCast?: PersonInfo[];
  // 타이틀 로고
  private readonly _titleLogo?: string;
  private readonly _titleLogoLang?: LogoLanguage;

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
    this._overview = props.overview;
    this._uploadedAt = props.uploadedAt ? new Date(props.uploadedAt) : undefined;
    this._voteAverage = props.voteAverage;
    this._popularity = props.popularity;
    this._originCountry = props.originCountry;
    this._directors = props.directors;
    this._mainCast = props.mainCast;
    this._titleLogo = props.titleLogo;
    this._titleLogoLang = props.titleLogoLang;
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

  get overview(): string | undefined {
    return this._overview;
  }

  get uploadedAt(): Date | undefined {
    return this._uploadedAt;
  }

  get voteAverage(): number | undefined {
    return this._voteAverage;
  }

  get popularity(): number | undefined {
    return this._popularity;
  }

  get originCountry(): string[] | undefined {
    return this._originCountry;
  }

  get directors(): PersonInfo[] | undefined {
    return this._directors;
  }

  get mainCast(): PersonInfo[] | undefined {
    return this._mainCast;
  }

  get titleLogo(): string | undefined {
    return this._titleLogo;
  }

  get titleLogoLang(): LogoLanguage | undefined {
    return this._titleLogoLang;
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
      overview: this._overview,
      uploadedAt: this._uploadedAt?.toISOString(),
      voteAverage: this._voteAverage,
      popularity: this._popularity,
      originCountry: this._originCountry,
      directors: this._directors,
      mainCast: this._mainCast,
      titleLogo: this._titleLogo,
      titleLogoLang: this._titleLogoLang,
    };
  }
}
