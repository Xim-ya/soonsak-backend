import { ContentTypeValue } from '../value-objects';

/**
 * 홈 섹션 아이템 Props (섹션 내 콘텐츠)
 */
export interface HomeSectionItemProps {
  id?: string;
  sectionId: string;
  contentId: number;
  contentType: ContentTypeValue;
  displayOrder: number;
}

/**
 * 홈 섹션 Props
 */
export interface HomeSectionProps {
  id?: string;
  title: string;
  subtitle?: string;
  themeKeywords?: string[];
  displayOrder: number;
  isActive?: boolean;
  generatedAt?: string;
  expiresAt?: string;
  aiReasoning?: string;
  items?: HomeSectionItemProps[];
}

/**
 * 홈 섹션 아이템 도메인 엔티티
 */
export class HomeSectionItem {
  private readonly _id?: string;
  private readonly _sectionId: string;
  private readonly _contentId: number;
  private readonly _contentType: ContentTypeValue;
  private readonly _displayOrder: number;

  private constructor(props: HomeSectionItemProps) {
    this._id = props.id;
    this._sectionId = props.sectionId;
    this._contentId = props.contentId;
    this._contentType = props.contentType;
    this._displayOrder = props.displayOrder;
  }

  static create(props: HomeSectionItemProps): HomeSectionItem {
    return new HomeSectionItem(props);
  }

  static reconstitute(props: HomeSectionItemProps): HomeSectionItem {
    return new HomeSectionItem(props);
  }

  get id(): string | undefined {
    return this._id;
  }

  get sectionId(): string {
    return this._sectionId;
  }

  get contentId(): number {
    return this._contentId;
  }

  get contentType(): ContentTypeValue {
    return this._contentType;
  }

  get displayOrder(): number {
    return this._displayOrder;
  }

  toProps(): HomeSectionItemProps {
    return {
      id: this._id,
      sectionId: this._sectionId,
      contentId: this._contentId,
      contentType: this._contentType,
      displayOrder: this._displayOrder,
    };
  }
}

/**
 * 홈 섹션 도메인 엔티티
 * OTT 스타일 메인 홈 화면의 테마별 콘텐츠 섹션
 */
export class HomeSection {
  private readonly _id?: string;
  private readonly _title: string;
  private readonly _subtitle?: string;
  private readonly _themeKeywords?: string[];
  private readonly _displayOrder: number;
  private readonly _isActive: boolean;
  private readonly _generatedAt?: Date;
  private readonly _expiresAt?: Date;
  private readonly _aiReasoning?: string;
  private readonly _items: HomeSectionItem[];

  private constructor(props: HomeSectionProps) {
    this._id = props.id;
    this._title = props.title;
    this._subtitle = props.subtitle;
    this._themeKeywords = props.themeKeywords;
    this._displayOrder = props.displayOrder;
    this._isActive = props.isActive ?? true;
    this._generatedAt = props.generatedAt ? new Date(props.generatedAt) : undefined;
    this._expiresAt = props.expiresAt ? new Date(props.expiresAt) : undefined;
    this._aiReasoning = props.aiReasoning;
    this._items = (props.items || []).map((item) =>
      HomeSectionItem.reconstitute(item),
    );
  }

  /**
   * 새로운 홈 섹션 생성 (AI 생성 시)
   */
  static create(props: Omit<HomeSectionProps, 'id' | 'generatedAt'>): HomeSection {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3일 후

    return new HomeSection({
      ...props,
      generatedAt: now.toISOString(),
      expiresAt: props.expiresAt || expiresAt.toISOString(),
      isActive: props.isActive ?? true,
    });
  }

  /**
   * DB에서 재구성
   */
  static reconstitute(props: HomeSectionProps): HomeSection {
    return new HomeSection(props);
  }

  get id(): string | undefined {
    return this._id;
  }

  get title(): string {
    return this._title;
  }

  get subtitle(): string | undefined {
    return this._subtitle;
  }

  get themeKeywords(): string[] | undefined {
    return this._themeKeywords;
  }

  get displayOrder(): number {
    return this._displayOrder;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  get generatedAt(): Date | undefined {
    return this._generatedAt;
  }

  get expiresAt(): Date | undefined {
    return this._expiresAt;
  }

  get aiReasoning(): string | undefined {
    return this._aiReasoning;
  }

  get items(): HomeSectionItem[] {
    return this._items;
  }

  /**
   * 섹션이 만료되었는지 확인
   */
  isExpired(): boolean {
    if (!this._expiresAt) return false;
    return new Date() > this._expiresAt;
  }

  /**
   * 섹션이 활성 상태인지 확인 (is_active && not expired)
   */
  isValid(): boolean {
    return this._isActive && !this.isExpired();
  }

  toProps(): HomeSectionProps {
    return {
      id: this._id,
      title: this._title,
      subtitle: this._subtitle,
      themeKeywords: this._themeKeywords,
      displayOrder: this._displayOrder,
      isActive: this._isActive,
      generatedAt: this._generatedAt?.toISOString(),
      expiresAt: this._expiresAt?.toISOString(),
      aiReasoning: this._aiReasoning,
      items: this._items.map((item) => item.toProps()),
    };
  }
}
