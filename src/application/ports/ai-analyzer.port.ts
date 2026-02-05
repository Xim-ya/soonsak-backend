import { ContentTypeValue } from '@/domain/value-objects';
import { ContentMatchResult } from './content-search.port';

/**
 * AI 분석 파라미터
 */
export interface AIAnalyzeParams {
  videoId: string;
  videoDuration: number;
  tmdbCandidates: ContentMatchResult[];
}

/**
 * 선택된 TMDB 매치 정보
 */
export interface SelectedTMDBMatch {
  tmdbId: number;
  type: ContentTypeValue;
  confidence: number;
  reasoning: string;
}

/**
 * AI 분석 결과
 */
export interface AIAnalysisResult {
  includesEnding: boolean;
  confidence: number;
  reasoning: string;
  extractedContent: string;
  extractedTitles?: string[];
  inferredTitles?: string[];
  /** 영어 원제 목록 (한글 제목의 영어 원제 또는 직접 언급된 영어 제목) */
  englishTitles?: string[];
  selectedTMDBMatch?: SelectedTMDBMatch;
}

/**
 * AI 분석기 포트 (OpenAI 추상화)
 */
export interface IAIAnalyzerPort {
  /**
   * 비디오 콘텐츠 분석
   */
  analyzeVideoContent(params: AIAnalyzeParams): Promise<AIAnalysisResult>;

  /**
   * 결말 포함 여부 분석
   */
  analyzeEndingContent(
    videoId: string,
    videoDuration: number,
  ): Promise<{
    includesEnding: boolean;
    confidence: number;
    reasoning: string;
  }>;
}
