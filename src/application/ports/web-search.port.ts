/**
 * 웹 검색 결과 항목
 */
export interface WebSearchResultItem {
  /** 검색 결과 제목 */
  title: string;
  /** 검색 결과 URL */
  link: string;
  /** 검색 결과 스니펫 */
  snippet: string;
}

/**
 * 웹 검색 결과
 */
export interface WebSearchResult {
  /** 검색어 */
  query: string;
  /** 검색 결과 목록 */
  items: WebSearchResultItem[];
}

/**
 * 영화 제목 추출 결과
 */
export interface ExtractedMovieTitle {
  /** 추출된 영화 제목 */
  title: string;
  /** 영어 제목 (있는 경우) */
  englishTitle?: string;
  /** 개봉 연도 (있는 경우) */
  year?: number;
  /** 신뢰도 (0-100) */
  confidence: number;
}

/**
 * 웹 검색 포트 (외부 검색 API 추상화)
 */
export interface IWebSearchPort {
  /**
   * 웹 검색 수행
   * @param query 검색어
   * @param options 검색 옵션
   */
  search(
    query: string,
    options?: { limit?: number },
  ): Promise<WebSearchResult>;

  /**
   * 웹 검색으로 영화 제목 추출
   * 검색 결과에서 영화 제목을 추출하고 TMDB 검색에 사용
   * @param queries 검색어 목록
   */
  searchAndExtractMovieTitles(
    queries: string[],
  ): Promise<ExtractedMovieTitle[]>;
}
