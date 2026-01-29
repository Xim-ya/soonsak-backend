import { HomeSection, HomeSectionProps } from '../entities/home-section.entity';

/**
 * AI 생성 섹션 입력 데이터
 */
export interface CreateHomeSectionInput {
  title: string;
  subtitle?: string;
  themeKeywords?: string[];
  displayOrder: number;
  aiReasoning?: string;
  contentIds: Array<{
    contentId: number;
    contentType: 'movie' | 'tv';
  }>;
}

/**
 * 홈 섹션 리포지토리 인터페이스
 */
export interface IHomeSectionRepository {
  /**
   * 활성화된 모든 홈 섹션 조회 (만료되지 않은 것만)
   */
  findAllActive(): Promise<HomeSection[]>;

  /**
   * ID로 홈 섹션 조회
   */
  findById(id: string): Promise<HomeSection | null>;

  /**
   * 홈 섹션 저장 (섹션 및 아이템 함께)
   */
  save(section: HomeSection): Promise<string>;

  /**
   * 여러 홈 섹션 일괄 저장 (기존 활성 섹션 비활성화 후)
   */
  saveAll(sections: HomeSection[]): Promise<string[]>;

  /**
   * 기존 활성 섹션 모두 비활성화
   */
  deactivateAll(): Promise<void>;

  /**
   * 만료된 섹션 정리 (soft delete - is_active = false)
   */
  cleanupExpired(): Promise<number>;

  /**
   * RPC 함수를 통한 홈 섹션 조회 (contents 포함)
   */
  getHomeSectionsWithContents(): Promise<HomeSectionWithContents[]>;
}

/**
 * RPC 결과 타입 (contents 정보 포함)
 */
export interface HomeSectionWithContents {
  sectionId: string;
  sectionTitle: string;
  sectionSubtitle?: string;
  themeKeywords?: string[];
  displayOrder: number;
  generatedAt?: string;
  expiresAt?: string;
  contents: Array<{
    id: number;
    contentType: string;
    title: string;
    posterPath?: string;
    backdropPath?: string;
    tagline?: string;
    overview?: string;
    releaseDate?: string;
    genreIds?: number[];
  }>;
}
