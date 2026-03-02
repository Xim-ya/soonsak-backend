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
 * Phase 1: 직접 추출 파라미터
 */
export interface DirectExtractionParams {
  videoId: string;
  videoTitle: string;
  videoDescription: string;
  /** 영상 런타임 (초) - 결말 판단용 */
  videoDuration?: number;
}

/**
 * Phase 1: 직접 추출 결과
 */
export interface DirectExtractionResult {
  /** 직접 추출된 제목 (명시적 언급만) */
  extractedTitle: string | null;
  /** 추출 신뢰도 (0-100) */
  confidence: number;
  /** 미디어 타입 힌트 */
  mediaTypeHint: 'movie' | 'tv' | 'anime' | 'documentary' | null;
  /** 추출 근거 */
  reasoning: string;
  /** 결말 포함 여부 */
  includesEnding: boolean;
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
  /** AI가 추론한 개봉/방영 연도 (동명 영화 구분용) */
  inferredYear?: number | null;
  /** AI가 추론한 장르 목록 (TMDB 후보 선택 가중치용) */
  inferredGenres?: string[];
  /** 웹 검색어 목록 (제목 추론 실패 시 웹 검색에 사용) */
  searchQueries?: string[];
  selectedTMDBMatch?: SelectedTMDBMatch;
}

/**
 * AI 분석기 포트 (OpenAI 추상화)
 */
export interface IAIAnalyzerPort {
  /**
   * Phase 1: 직접 추출 (Simple Extraction)
   * 자막에서 명시적으로 언급된 제목만 추출
   * confidence >= 80이면 Phase 2 스킵 가능
   */
  extractDirectMention(params: DirectExtractionParams): Promise<DirectExtractionResult>;

  /**
   * Phase 2: 추론 분석 (Inference)
   * 줄거리 기반 추론, 웹 검색어 생성 등 복잡한 분석
   * Phase 1 실패 시에만 호출
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
