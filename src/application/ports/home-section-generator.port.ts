/**
 * 인물 정보 (감독/배우) - AI 프롬프트용
 */
export interface PersonInfoForSection {
  id: number;
  name: string;
}

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
  // AI 분석 개선을 위한 추가 필드
  voteAverage?: number;              // TMDB 평점 (0-10)
  popularity?: number;               // TMDB 인기도 점수
  originCountry?: string[];          // 제작 국가 코드
  directors?: PersonInfoForSection[];   // 감독 정보 (ID + 이름)
  mainCast?: PersonInfoForSection[];    // 주요 출연진 (ID + 이름)
}

/**
 * 이전 섹션 정보 (중복 방지용)
 */
export interface PreviousSectionInfo {
  title: string;
  themeKeywords: string[];
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
   * @param previousSections 이전 섹션 정보 (중복 방지용)
   */
  generateSections(
    contents: ContentMetadataForSection[],
    sectionCount?: number,
    itemsPerSection?: number,
    previousSections?: PreviousSectionInfo[],
  ): Promise<HomeSectionGenerationResult>;
}
