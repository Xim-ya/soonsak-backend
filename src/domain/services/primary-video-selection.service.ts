import { Injectable } from '@nestjs/common';
import { ContentTypeValue } from '../value-objects';
import { SELECTION_SCORE_WEIGHTS, TMDB_GENRE_MAP } from '@/shared/constants';
import { compareTwoStrings } from '@/shared/utils/string.util';

/**
 * AI 추론 정보 (장르/연도/미디어타입 가중치용)
 */
export interface AIInferenceInfo {
  inferredYear?: number | null;
  inferredGenres?: string[];
  /** YouTube 제목에서 추출한 미디어 타입 힌트 ('tv' = 드라마, 'movie' = 영화) */
  mediaTypeHint?: 'tv' | 'movie' | null;
}

/**
 * TMDB 검색 결과 타입
 */
export interface TMDBSearchResultData {
  id: number;
  title?: string;
  name?: string;
  originalTitle?: string;
  originalName?: string;
  releaseDate?: string;
  firstAirDate?: string;
  overview: string;
  posterPath?: string;
  backdropPath?: string;
  popularity: number;
  voteAverage: number;
  voteCount: number;
  genreIds?: number[];
  originalLanguage?: string;
  mediaType: ContentTypeValue;
}

/**
 * TMDB 매칭 결과
 */
export interface TMDBMatchResult {
  type: ContentTypeValue;
  data: TMDBSearchResultData;
  confidence?: number;
  searchTerm?: string;
}

/**
 * Primary 비디오 선택 서비스
 * 점수 기반으로 최적의 TMDB 후보를 선택하는 로직
 */
@Injectable()
export class PrimaryVideoSelectionService {
  /**
   * 점수 기반 최적 TMDB 후보 선택
   */
  selectBestCandidate(
    candidates: TMDBMatchResult[],
    titleCandidates: string[],
    description?: string,
    aiInference?: AIInferenceInfo,
  ): TMDBMatchResult | null {
    if (candidates.length === 0) {
      return null;
    }

    const yearHint = this.extractYearHint(description);
    const hasMovieEmoji = description?.includes('🎬') || false;

    const scoredCandidates = candidates.map((candidate, index) => {
      const score = this.calculateScore(
        candidate,
        titleCandidates,
        yearHint,
        hasMovieEmoji,
        index,
        aiInference,
      );
      return { candidate, score };
    });

    scoredCandidates.sort((a, b) => b.score - a.score);

    const best = scoredCandidates[0];
    if (best.score < SELECTION_SCORE_WEIGHTS.MIN_MATCH_SCORE) {
      return null;
    }

    return best.candidate;
  }

  /**
   * 후보들의 점수 계산 결과 반환 (디버깅용)
   */
  getCandidateScores(
    candidates: TMDBMatchResult[],
    titleCandidates: string[],
    description?: string,
    aiInference?: AIInferenceInfo,
  ): Array<{ candidate: TMDBMatchResult; score: number }> {
    const yearHint = this.extractYearHint(description);
    const hasMovieEmoji = description?.includes('🎬') || false;

    return candidates.map((candidate, index) => ({
      candidate,
      score: this.calculateScore(
        candidate,
        titleCandidates,
        yearHint,
        hasMovieEmoji,
        index,
        aiInference,
      ),
    }));
  }

  private calculateScore(
    candidate: TMDBMatchResult,
    titleCandidates: string[],
    yearHint: number | null,
    hasMovieEmoji: boolean,
    index: number,
    aiInference?: AIInferenceInfo,
  ): number {
    let score = 0;

    const tmdbTitle =
      candidate.type === 'movie' ? candidate.data.title : candidate.data.name;
    const tmdbOriginalTitle =
      candidate.type === 'movie' ? candidate.data.originalTitle : candidate.data.originalName;

    // 제목 유사도 점수 (정확일치 > 높은 유사도 > 중간 유사도)
    const titleScore = this.calculateTitleSimilarityScore(
      titleCandidates,
      tmdbTitle,
      tmdbOriginalTitle,
    );
    score += titleScore;

    // 영화 이모지 보너스
    if (hasMovieEmoji && candidate.type === 'movie') {
      score += SELECTION_SCORE_WEIGHTS.MOVIE_EMOJI_BONUS;
    }

    // 연도 일치 점수 (description에서 추출)
    const releaseDate =
      candidate.type === 'movie'
        ? candidate.data.releaseDate
        : candidate.data.firstAirDate;
    const releaseYear = releaseDate ? parseInt(releaseDate.split('-')[0], 10) : null;

    if (yearHint && releaseYear) {
      if (releaseYear === yearHint) {
        score += SELECTION_SCORE_WEIGHTS.YEAR_MATCH;
      }
    }

    // AI 추론 연도 가중치 (동명 영화 구분에 중요)
    if (aiInference?.inferredYear && releaseYear) {
      const yearDiff = Math.abs(releaseYear - aiInference.inferredYear);
      if (yearDiff === 0) {
        score += SELECTION_SCORE_WEIGHTS.AI_YEAR_MATCH;
      } else if (yearDiff === 1) {
        score += SELECTION_SCORE_WEIGHTS.AI_YEAR_CLOSE;
      } else if (yearDiff > 10) {
        // 10년 초과 차이 → 대형 페널티 (잘못된 동명이인 콘텐츠 방지)
        score += SELECTION_SCORE_WEIGHTS.AI_YEAR_MAJOR_MISMATCH_PENALTY;
      } else if (yearDiff > 5) {
        // 5년 초과 차이 → 페널티
        score += SELECTION_SCORE_WEIGHTS.AI_YEAR_MISMATCH_PENALTY;
      }
    }

    // AI 추론 장르 가중치 (TMDB 장르와 비교)
    if (aiInference?.inferredGenres && aiInference.inferredGenres.length > 0 && candidate.data.genreIds) {
      const genreMatchScore = this.calculateGenreMatchScore(
        candidate.data.genreIds,
        aiInference.inferredGenres,
      );
      score += genreMatchScore;
    }

    // 미디어 타입 일치/불일치 점수 (YouTube 제목이 "드라마"인데 영화로 매칭 등)
    if (aiInference?.mediaTypeHint) {
      const candidateType = candidate.type;
      if (aiInference.mediaTypeHint === candidateType) {
        // 미디어 타입 일치 보너스
        score += SELECTION_SCORE_WEIGHTS.MEDIA_TYPE_MATCH_BONUS;
      } else {
        // 미디어 타입 불일치 페널티
        score += SELECTION_SCORE_WEIGHTS.MEDIA_TYPE_MISMATCH_PENALTY;
      }
    }

    // 인기도 기반 점수 (동일 제목 다수 후보 구분에 중요)
    const popularity = candidate.data.popularity || 0;
    if (popularity >= 10) {
      score += SELECTION_SCORE_WEIGHTS.HIGH_POPULARITY_BONUS;
    } else if (popularity >= 1) {
      score += SELECTION_SCORE_WEIGHTS.MODERATE_POPULARITY_BONUS;
    } else if (popularity < 0.5) {
      score += SELECTION_SCORE_WEIGHTS.LOW_POPULARITY_PENALTY;
    }

    // 오래된 콘텐츠 페널티 (현대 유튜버가 리뷰할 확률 낮음)
    if (releaseYear) {
      const currentYear = new Date().getFullYear();
      const age = currentYear - releaseYear;
      if (age >= 80) {
        score += SELECTION_SCORE_WEIGHTS.VERY_OLD_CONTENT_PENALTY;
      } else if (age >= 50) {
        score += SELECTION_SCORE_WEIGHTS.OLD_CONTENT_PENALTY;
      }
    }

    // 첫 번째 후보 보너스
    if (index === 0) {
      score += SELECTION_SCORE_WEIGHTS.FIRST_CANDIDATE_BONUS;
    }

    return score;
  }

  /**
   * AI 추론 장르와 TMDB 장르 일치 점수 계산
   */
  private calculateGenreMatchScore(
    tmdbGenreIds: number[],
    inferredGenres: string[],
  ): number {
    const tmdbGenreNames = tmdbGenreIds
      .map((id) => TMDB_GENRE_MAP[id])
      .filter(Boolean);

    let matchCount = 0;
    for (const inferredGenre of inferredGenres) {
      if (tmdbGenreNames.includes(inferredGenre)) {
        matchCount++;
      }
    }

    let score = matchCount * SELECTION_SCORE_WEIGHTS.AI_GENRE_MATCH;
    if (matchCount >= 2) {
      score += SELECTION_SCORE_WEIGHTS.AI_GENRE_MULTI_MATCH_BONUS;
    }

    return score;
  }

  private calculateTitleSimilarityScore(
    titleCandidates: string[],
    tmdbTitle?: string,
    tmdbOriginalTitle?: string,
  ): number {
    const titlesToCompare = [tmdbTitle, tmdbOriginalTitle].filter(Boolean) as string[];
    if (titlesToCompare.length === 0 || titleCandidates.length === 0) return 0;

    let bestScore = 0;

    for (const candidate of titleCandidates) {
      // 타입 검증: 문자열이 아닌 값은 스킵
      if (typeof candidate !== 'string' || candidate.length < 2) continue;
      for (const tmdb of titlesToCompare) {
        // 정확 일치
        if (candidate.toLowerCase() === tmdb.toLowerCase()) {
          return SELECTION_SCORE_WEIGHTS.EXACT_TITLE_MATCH;
        }
        // Dice 계수 유사도 (4자 이상인 경우만)
        if (candidate.length >= 4) {
          const similarity = compareTwoStrings(candidate, tmdb);
          if (similarity >= 0.8) {
            bestScore = Math.max(bestScore, SELECTION_SCORE_WEIGHTS.HIGH_SIMILARITY_MATCH);
          } else if (similarity >= 0.6) {
            bestScore = Math.max(bestScore, SELECTION_SCORE_WEIGHTS.MODERATE_SIMILARITY_MATCH);
          }
        }
      }
    }

    return bestScore;
  }

  private extractYearHint(description?: string): number | null {
    if (!description) {
      return null;
    }

    const yearMatch = description.match(/\((\d{4})\)/);
    if (yearMatch) {
      return parseInt(yearMatch[1], 10);
    }

    return null;
  }
}
