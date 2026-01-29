/**
 * 홈 섹션 생성 요청 DTO
 */
export interface GenerateHomeSectionsInput {
  /** 생성할 섹션 수 (기본 5) */
  sectionCount?: number;
  /** 섹션당 콘텐츠 수 (기본 10) */
  itemsPerSection?: number;
  /** 강제 재생성 여부 (만료 전이라도 재생성) */
  forceRegenerate?: boolean;
}

/**
 * 섹션 요약 정보 (알림용)
 */
export interface SectionSummary {
  title: string;
  contentCount: number;
}

/**
 * 홈 섹션 생성 결과 DTO
 */
export interface GenerateHomeSectionsOutput {
  /** 성공 여부 */
  success: boolean;
  /** 생성된 섹션 수 */
  sectionCount: number;
  /** 섹션 ID 목록 */
  sectionIds: string[];
  /** 섹션 요약 정보 (알림용) */
  sections: SectionSummary[];
  /** 생성 시각 */
  generatedAt: Date;
  /** 메시지 */
  message: string;
}
