import { Injectable } from '@nestjs/common';
import { ContentTypeValue } from '../value-objects';
import { SELECTION_SCORE_WEIGHTS } from '@/shared/constants';
import { compareTwoStrings } from '@/shared/utils/string.util';

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
  ): TMDBMatchResult {
    if (candidates.length === 0) {
      throw new Error('No candidates to select from');
    }

    if (candidates.length === 1) {
      return candidates[0];
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
      );
      return { candidate, score };
    });

    scoredCandidates.sort((a, b) => b.score - a.score);

    return scoredCandidates[0].candidate;
  }

  /**
   * 후보들의 점수 계산 결과 반환 (디버깅용)
   */
  getCandidateScores(
    candidates: TMDBMatchResult[],
    titleCandidates: string[],
    description?: string,
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
      ),
    }));
  }

  private calculateScore(
    candidate: TMDBMatchResult,
    titleCandidates: string[],
    yearHint: number | null,
    hasMovieEmoji: boolean,
    index: number,
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

    // 연도 일치 점수
    if (yearHint) {
      const releaseDate =
        candidate.type === 'movie'
          ? candidate.data.releaseDate
          : candidate.data.firstAirDate;
      if (releaseDate) {
        const releaseYear = parseInt(releaseDate.split('-')[0], 10);
        if (releaseYear === yearHint) {
          score += SELECTION_SCORE_WEIGHTS.YEAR_MATCH;
        }
      }
    }

    // 첫 번째 후보 보너스
    if (index === 0) {
      score += SELECTION_SCORE_WEIGHTS.FIRST_CANDIDATE_BONUS;
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
      if (candidate.length < 2) continue;
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
