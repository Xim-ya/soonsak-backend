/**
 * AI 홈 섹션 생성에 사용되는 콘텐츠 메타데이터
 */
export interface ContentMetadataForSection {
  id: number;
  contentType: 'movie' | 'tv';
  title: string;
  genreIds?: number[];
  tagline?: string;
  overview?: string;
  originalLanguage?: string;
  releaseDate?: string;
}

/**
 * AI가 생성한 섹션 결과
 */
export interface GeneratedSection {
  title: string;
  subtitle?: string;
  themeKeywords: string[];
  contentIds: Array<{
    contentId: number;
    contentType: 'movie' | 'tv';
  }>;
  reasoning: string;
}

/**
 * 홈 섹션 생성 결과
 */
export interface HomeSectionGenerationResult {
  sections: GeneratedSection[];
  generatedAt: Date;
}

/**
 * 홈 섹션 생성 포트 인터페이스
 * AI 기반 테마별 섹션 자동 생성
 */
export interface IHomeSectionGeneratorPort {
  /**
   * 전체 콘텐츠 메타데이터를 기반으로 테마별 섹션 생성
   * @param contents 분석할 콘텐츠 목록
   * @param sectionCount 생성할 섹션 수 (기본 5개)
   * @param itemsPerSection 섹션당 콘텐츠 수 (기본 8-12개)
   */
  generateSections(
    contents: ContentMetadataForSection[],
    sectionCount?: number,
    itemsPerSection?: number,
  ): Promise<HomeSectionGenerationResult>;
}
