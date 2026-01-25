import { ContentType } from './tmdb.types';

/**
 * AI가 추출한 콘텐츠 정보
 */
export interface ExtractedContent {
  type: ContentType;
  titleKo: string;
  titleEn: string;
  releaseYear?: string;
  confidence: number;
}

/**
 * AI 스크립트 분석 결과
 */
export interface ScriptAnalysisResult {
  includesEnding: boolean;
  confidence: number;
  reasoning: string;
  extractedContent: string;
  extractedTitles?: string[];
  selectedTMDBMatch?: {
    tmdbId: number;
    type: ContentType;
    confidence: number;
    reasoning: string;
  };
}
