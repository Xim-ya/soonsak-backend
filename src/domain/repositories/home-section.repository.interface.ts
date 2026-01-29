import { HomeSection } from '../entities/home-section.entity';
import { PreviousSectionInfo } from '@/application/ports';

/**
 * 홈 섹션 리포지토리 인터페이스
 */
export interface IHomeSectionRepository {
  /**
   * 활성화된 모든 홈 섹션 조회 (is_active = true)
   */
  findAllActive(): Promise<HomeSection[]>;

  /**
   * ID로 홈 섹션 조회
   */
  findById(id: string): Promise<HomeSection | null>;

  /**
   * 홈 섹션 저장
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
   * RPC 함수를 통한 홈 섹션 조회 (contents 포함)
   */
  getHomeSectionsWithContents(): Promise<HomeSectionWithContents[]>;

  /**
   * 이전 섹션 정보 조회 (중복 방지용)
   * @param limit 조회할 최대 섹션 수 (기본 30)
   */
  findPreviousSections(limit?: number): Promise<PreviousSectionInfo[]>;
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
