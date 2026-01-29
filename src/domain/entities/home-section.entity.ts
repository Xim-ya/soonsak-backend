import { ContentTypeValue } from '../value-objects';

/**
 * 섹션 내 콘텐츠 참조
 */
export interface SectionContentRef {
  id: number;
  type: ContentTypeValue;
}

/**
 * 홈 섹션 Props
 */
export interface HomeSectionProps {
  id?: string;
  title: string;
  subtitle?: string;
  themeKeywords?: string[];
  contentIds: SectionContentRef[];
  displayOrder: number;
  isActive?: boolean;
  generatedAt?: string;
  aiReasoning?: string;
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
  private readonly _contentIds: SectionContentRef[];
  private readonly _displayOrder: number;
  private readonly _isActive: boolean;
  private readonly _generatedAt?: Date;
  private readonly _aiReasoning?: string;

  private constructor(props: HomeSectionProps) {
    this._id = props.id;
    this._title = props.title;
    this._subtitle = props.subtitle;
    this._themeKeywords = props.themeKeywords;
    this._contentIds = props.contentIds;
    this._displayOrder = props.displayOrder;
    this._isActive = props.isActive ?? true;
    this._generatedAt = props.generatedAt ? new Date(props.generatedAt) : undefined;
    this._aiReasoning = props.aiReasoning;
  }

  /**
   * 새로운 홈 섹션 생성 (AI 생성 시)
   */
  static create(props: Omit<HomeSectionProps, 'id' | 'generatedAt'>): HomeSection {
    return new HomeSection({
      ...props,
      generatedAt: new Date().toISOString(),
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

  get contentIds(): SectionContentRef[] {
    return this._contentIds;
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

  get aiReasoning(): string | undefined {
    return this._aiReasoning;
  }

  /**
   * 섹션이 활성 상태인지 확인
   */
  isValid(): boolean {
    return this._isActive;
  }

  toProps(): HomeSectionProps {
    return {
      id: this._id,
      title: this._title,
      subtitle: this._subtitle,
      themeKeywords: this._themeKeywords,
      contentIds: this._contentIds,
      displayOrder: this._displayOrder,
      isActive: this._isActive,
      generatedAt: this._generatedAt?.toISOString(),
      aiReasoning: this._aiReasoning,
    };
  }
}
