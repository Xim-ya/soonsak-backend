import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS, MESSAGES, TMDB_CONFIG } from '@/shared/constants';
import { compareTwoStrings } from '@/shared/utils/string.util';
import { Video, Content, Channel } from '@/domain/entities';
import { VideoId, TMDBId } from '@/domain/value-objects';
import { IVideoRepository, IContentRepository, IChannelRepository } from '@/domain/repositories';
import {
  TitleExtractionService,
  EndingDetectionService,
  PrimaryVideoSelectionService,
  TMDBMatchResult,
} from '@/domain/services';
import {
  IYouTubeExtractorPort,
  IContentSearchPort,
  IAIAnalyzerPort,
} from '@/application/ports';
import { AIAnalysisError } from '@/domain/errors/domain.error';
import { RegisterVideoInput, RegisterVideoResult } from './register-video.dto';

/**
 * 비디오 등록 Use Case
 * 핵심 비디오 등록 로직: YouTube 추출, TMDB 매칭, 데이터베이스 저장
 */
@Injectable()
export class RegisterVideoUseCase {
  private readonly logger = new Logger(RegisterVideoUseCase.name);

  constructor(
    @Inject(INJECTION_TOKENS.VIDEO_REPOSITORY)
    private readonly videoRepository: IVideoRepository,
    @Inject(INJECTION_TOKENS.CONTENT_REPOSITORY)
    private readonly contentRepository: IContentRepository,
    @Inject(INJECTION_TOKENS.CHANNEL_REPOSITORY)
    private readonly channelRepository: IChannelRepository,
    @Inject(INJECTION_TOKENS.YOUTUBE_EXTRACTOR)
    private readonly youtubeExtractor: IYouTubeExtractorPort,
    @Inject(INJECTION_TOKENS.CONTENT_SEARCH)
    private readonly contentSearch: IContentSearchPort,
    @Inject(INJECTION_TOKENS.AI_ANALYZER)
    private readonly aiAnalyzer: IAIAnalyzerPort,
    private readonly titleExtractionService: TitleExtractionService,
    private readonly endingDetectionService: EndingDetectionService,
    private readonly primaryVideoSelectionService: PrimaryVideoSelectionService,
  ) {}

  async execute(input: RegisterVideoInput): Promise<RegisterVideoResult> {
    const { videoId, title } = input;
    this.logger.log(`Registering video: ${title} (${videoId})`);

    try {
      const exists = await this.videoRepository.exists(VideoId.fromString(videoId));
      if (exists) {
        return {
          success: false,
          message: MESSAGES.VIDEO.ALREADY_PROCESSED,
        };
      }

      const videoInfo = await this.youtubeExtractor.getVideoInfo(videoId);

      // 쇼츠 영상 제외
      if (videoInfo.isShorts) {
        this.logger.log(`  Skipping Shorts video: ${videoInfo.title}`);
        return {
          success: false,
          message: '쇼츠 영상은 등록 대상이 아닙니다',
        };
      }

      this.logger.log(`  Video duration: ${Math.round(videoInfo.duration / 60)}분`);

      let selectedMatch: TMDBMatchResult | null = null;
      let includesEnding = this.endingDetectionService.detectFromContent(
        videoInfo.title,
        videoInfo.description,
      );
      let aiExtractedTitles: string[] = [];
      let aiInferredTitles: string[] = [];
      const allTmdbCandidates: TMDBMatchResult[] = [];

      // 1. AI 자막 분석 (항상 먼저 실행 — TMDB 후보 없이 순수 추출)
      this.logger.log(`  [Step 1] AI transcript analysis...`);
      try {
        const aiAnalysis = await this.aiAnalyzer.analyzeVideoContent({
          videoId,
          videoDuration: videoInfo.duration,
          tmdbCandidates: [],
        });

        includesEnding = aiAnalysis.includesEnding;
        aiExtractedTitles = aiAnalysis.extractedTitles || [];
        aiInferredTitles = aiAnalysis.inferredTitles || [];

        // 1-1. 직접 언급 제목으로 매칭 시도
        if (aiExtractedTitles.length > 0) {
          this.logger.log(`  [AI] Extracted titles: ${aiExtractedTitles.join(', ')}`);
          selectedMatch = await this.matchFromTitles(aiExtractedTitles, allTmdbCandidates, videoInfo.description, 'ai');
        } else {
          this.logger.log(`  [AI] No titles directly extracted`);
        }

        // 1-2. 직접 언급 실패 → 줄거리 추론 제목으로 폴백
        if (!selectedMatch && aiInferredTitles.length > 0) {
          this.logger.log(`  [AI] Inferred titles (plot-based): ${aiInferredTitles.join(', ')}`);
          selectedMatch = await this.matchFromTitles(aiInferredTitles, allTmdbCandidates, videoInfo.description, 'ai-inferred');
        }

        this.logger.log(`  AI ending: ${includesEnding ? '결말포함' : '결말없음'}`);
      } catch (error) {
        const errorMessage = error instanceof AIAnalysisError
          ? error.message
          : (error as Error).message;
        this.logger.warn(`  AI transcript analysis failed: ${errorMessage}`);
      }

      // 2. YouTube 제목 후보 폴백 (AI 매칭 실패 시)
      if (!selectedMatch) {
        const titleCandidates = this.titleExtractionService.extractCandidates(
          videoInfo.title,
          videoInfo.description,
        );
        this.logger.log(`  [Step 2] YouTube title fallback: ${titleCandidates.join(', ')}`);

        const ytTmdbCandidates = await this.searchTMDBCandidatesParallel(titleCandidates, videoInfo.description);
        for (const c of ytTmdbCandidates) {
          if (!allTmdbCandidates.find((e) => e.data.id === c.data.id)) {
            allTmdbCandidates.push(c);
          }
        }

        // 고신뢰도 매칭
        selectedMatch = this.findHighConfidenceMatch(ytTmdbCandidates, titleCandidates);
        if (selectedMatch) {
          this.logger.log(`  [MATCH] YT high confidence → ${selectedMatch.data.title || selectedMatch.data.name} (id=${selectedMatch.data.id}, path=yt-high-confidence)`);
        }

        // Scoring fallback (AI 추출 제목 + 추론 제목 + YouTube 제목 합산)
        if (!selectedMatch && allTmdbCandidates.length > 0) {
          const combinedTitles = [
            ...aiExtractedTitles,
            ...aiInferredTitles,
            ...titleCandidates,
          ].filter((t, i, arr) => arr.indexOf(t) === i);

          const scores = this.primaryVideoSelectionService.getCandidateScores(
            allTmdbCandidates,
            combinedTitles,
            videoInfo.description,
          );
          this.logger.log(`  [Step 3] Scoring fallback (${scores.length} candidates):`);
          scores
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .forEach(({ candidate, score }) => {
              const name = candidate.data.title || candidate.data.name;
              this.logger.log(`    → ${name} (id=${candidate.data.id}, score=${score})`);
            });

          selectedMatch = this.primaryVideoSelectionService.selectBestCandidate(
            allTmdbCandidates,
            combinedTitles,
            videoInfo.description,
          );
          if (selectedMatch) {
            this.logger.log(`  [MATCH] Scoring → ${selectedMatch.data.title || selectedMatch.data.name} (id=${selectedMatch.data.id}, path=scoring-fallback)`);
          }
        }
      }

      if (!selectedMatch) {
        if (allTmdbCandidates.length === 0) {
          return {
            success: false,
            message: MESSAGES.TMDB.MATCH_FAILED_NO_RESULTS,
          };
        }
        this.logger.log(`  [RESULT] 매칭 실패 - 최소 점수 미달`);
        return {
          success: false,
          message: 'TMDB 매칭 실패 - 충분한 유사도의 후보 없음',
        };
      }

      const tmdbData = selectedMatch.data;
      const tmdbTitle = selectedMatch.type === 'movie' ? tmdbData.title : tmdbData.name;

      this.logger.log(`  [RESULT] Selected: ${tmdbTitle} (${selectedMatch.type}, id=${tmdbData.id})`);

      // 5. 상세 정보 조회 (tagline)
      const details = await this.contentSearch.getDetails(tmdbData.id, selectedMatch.type);

      // 6. 채널 정보 저장 (새 채널이면 메타데이터 가져오기)
      const channelId = await this.getOrCreateChannelWithMetadata(
        videoInfo.channelId,
        videoInfo.channelTitle,
      );

      const releaseDate = selectedMatch.type === 'movie'
        ? tmdbData.releaseDate
        : tmdbData.firstAirDate;

      const content = Content.create({
        id: tmdbData.id,
        contentType: selectedMatch.type,
        title: tmdbTitle || '',
        posterPath: tmdbData.posterPath,
        backdropPath: tmdbData.backdropPath,
        releaseDate,
        genreIds: details.genreIds || tmdbData.genreIds,
        originalLanguage: tmdbData.originalLanguage,
        tagline: details.tagline,
        overview: details.overview,
        uploadedAt: new Date().toISOString(),
        // AI 분석용 메타데이터
        voteAverage: details.voteAverage,
        popularity: details.popularity,
        originCountry: details.originCountry,
        directors: details.directors,
        mainCast: details.mainCast,
      });

      const contentId = await this.contentRepository.save(content);

      const newVideoRuntime = Math.round(videoInfo.duration / 60);
      const existingVideos = await this.videoRepository.findByContentId(
        TMDBId.fromNumber(contentId),
      );

      const isPrimary = await this.determinePrimaryStatus(
        existingVideos,
        includesEnding,
        newVideoRuntime,
      );

      const video = Video.create({
        id: videoId,
        contentId,
        contentType: selectedMatch.type,
        title: videoInfo.title,
        runtime: newVideoRuntime,
        thumbnailUrl: videoInfo.thumbnail,
        isPrimary,
        channelId,
        includesEnding,
        uploadedAt: videoInfo.publishedAt,
        updatedAt: new Date().toISOString(),
        youtubeViewCount: videoInfo.viewCount,
        youtubeLikeCount: videoInfo.likeCount,
      });

      await this.videoRepository.save(video);

      this.logger.log(`  Saved: ${videoInfo.title} → ${tmdbTitle}`);

      return {
        success: true,
        message: '동영상 등록 완료',
        data: {
          videoId,
          youtubeTitle: videoInfo.title,
          tmdbTitle: tmdbTitle || '',
          tmdbType: selectedMatch.type,
          tmdbId: tmdbData.id,
          includesEnding,
          contentId,
        },
      };
    } catch (error) {
      this.logger.error(`  Registration failed: ${(error as Error).message}`);
      return {
        success: false,
        message: `등록 실패: ${(error as Error).message}`,
      };
    }
  }

  /**
   * 제목 목록으로 TMDB 검색 → 고신뢰도/스코어링/단일결과 매칭 시도
   */
  private async matchFromTitles(
    titles: string[],
    allTmdbCandidates: TMDBMatchResult[],
    description: string,
    pathPrefix: string,
  ): Promise<TMDBMatchResult | null> {
    // 괄호 안 원제를 별도 제목으로 분리: "한국제목 (Original)" → ["한국제목", "Original"]
    const expandedTitles = this.expandParenthesizedTitles(titles);
    const tmdbCandidates = await this.searchTMDBCandidatesParallel(expandedTitles.slice(0, 5));

    if (tmdbCandidates.length === 0) return null;

    // 중복 제거하며 전체 목록에 추가
    for (const c of tmdbCandidates) {
      if (!allTmdbCandidates.find((e) => e.data.id === c.data.id)) {
        allTmdbCandidates.push(c);
      }
    }

    // 고신뢰도 매칭
    let match = this.findHighConfidenceMatch(tmdbCandidates, titles);
    if (match) {
      this.logger.log(`  [MATCH] ${pathPrefix} high confidence → ${match.data.title || match.data.name} (id=${match.data.id}, path=${pathPrefix}-high-confidence)`);
      return match;
    }

    // 스코어링 매칭
    match = this.primaryVideoSelectionService.selectBestCandidate(tmdbCandidates, titles, description);
    if (match) {
      this.logger.log(`  [MATCH] ${pathPrefix} scoring → ${match.data.title || match.data.name} (id=${match.data.id}, path=${pathPrefix}-extracted)`);
      return match;
    }

    // 단일 결과 신뢰
    if (tmdbCandidates.length === 1) {
      match = tmdbCandidates[0];
      this.logger.log(`  [MATCH] ${pathPrefix} single result (trusted) → ${match.data.title || match.data.name} (id=${match.data.id}, path=${pathPrefix}-single)`);
      return match;
    }

    return null;
  }

  /**
   * TMDB 병렬 검색
   * 순차 호출 → Promise.all 병렬 호출로 변경
   */
  private async searchTMDBCandidatesParallel(
    titleCandidates: string[],
    description?: string,
  ): Promise<TMDBMatchResult[]> {
    const validCandidates = titleCandidates
      .slice(0, TMDB_CONFIG.MAX_CANDIDATES)
      .filter((c) => c.length >= TMDB_CONFIG.MIN_TITLE_LENGTH && c.length <= TMDB_CONFIG.MAX_TITLE_LENGTH);

    if (validCandidates.length === 0) {
      return [];
    }

    // 연도 힌트 추출 (제목 또는 설명에서)
    const yearHint = this.extractYearHint(validCandidates, description);

    // 검색 쿼리 변형 생성 (한국어+숫자 공백 정규화)
    const searchQueries = this.expandSearchQueries(validCandidates);

    // 병렬로 모든 검색 실행
    const searchPromises = searchQueries.map(async (candidate) => {
      try {
        const results = await this.contentSearch.searchMulti(candidate, yearHint || undefined);
        return { candidate, results, error: null };
      } catch (err) {
        return { candidate, results: [], error: err };
      }
    });

    const searchResults = await Promise.all(searchPromises);

    // 결과 병합 (중복 제거)
    const tmdbCandidates: TMDBMatchResult[] = [];
    const searchSummary: string[] = [];

    for (const { candidate, results, error } of searchResults) {
      if (error) {
        searchSummary.push(`${candidate}:ERR`);
        continue;
      }
      searchSummary.push(`${candidate}:${results.length}`);
      for (const result of results) {
        if (!tmdbCandidates.find((c) => c.data.id === result.data.id)) {
          tmdbCandidates.push({
            type: result.type,
            data: result.data,
            confidence: 0,
            searchTerm: candidate,
          });
        }
      }
    }

    this.logger.log(
      `  Found ${tmdbCandidates.length} TMDB candidates (${searchSummary.join(', ')})`,
    );

    return tmdbCandidates;
  }

  /**
   * 고신뢰도 매칭 찾기
   * 조건: Dice 유사도 ≥ 0.95 + 높은 인기도 + 경쟁 후보 없음
   * 이 조건을 만족하면 AI 호출 스킵 가능
   */
  private findHighConfidenceMatch(
    tmdbCandidates: TMDBMatchResult[],
    titleCandidates: string[],
  ): TMDBMatchResult | null {
    if (tmdbCandidates.length === 0) {
      return null;
    }

    // 유효한 제목 후보만 필터 (3자 이상)
    const validTitles = titleCandidates.filter((t) => t.trim().length >= 3);
    if (validTitles.length === 0) {
      return null;
    }

    // 각 후보의 최고 유사도 계산
    const scored = tmdbCandidates.map((candidate) => {
      const tmdbTitle = (candidate.data.title || candidate.data.name || '').toLowerCase();
      const tmdbOriginalTitle = (candidate.data.originalTitle || candidate.data.originalName || '').toLowerCase();
      const titlesToCompare = [tmdbTitle, tmdbOriginalTitle].filter((t) => t.length > 0);

      let bestSimilarity = 0;
      for (const title of validTitles) {
        const normalized = title.toLowerCase().trim();
        for (const tmdb of titlesToCompare) {
          const similarity = compareTwoStrings(normalized, tmdb);
          bestSimilarity = Math.max(bestSimilarity, similarity);
        }
      }

      return { candidate, similarity: bestSimilarity };
    });

    // 유사도 내림차순 정렬
    scored.sort((a, b) => b.similarity - a.similarity);

    const best = scored[0];

    // 최고 유사도가 0.95 미만이면 고신뢰 아님
    if (best.similarity < 0.95) {
      return null;
    }

    // 경쟁 후보 체크: 2번째 후보의 유사도가 0.7 이상이면 애매하므로 AI에 위임
    if (scored.length >= 2 && scored[1].similarity >= 0.7) {
      return null;
    }

    // 인기도 체크
    const popularity = best.candidate.data.popularity || 0;
    if (popularity < TMDB_CONFIG.MIN_POPULARITY_THRESHOLD) {
      return null;
    }

    return best.candidate;
  }

  /**
   * 괄호 안 원제를 별도 제목으로 분리
   * "늑대의 살 아래 (La piel que habito)" → ["늑대의 살 아래", "La piel que habito"]
   */
  private expandParenthesizedTitles(titles: string[]): string[] {
    const expanded: string[] = [];
    for (const title of titles) {
      const match = title.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (match) {
        const main = match[1].trim();
        const inner = match[2].trim();
        if (main.length >= 2) expanded.push(main);
        if (inner.length >= 2) expanded.push(inner);
      } else {
        expanded.push(title);
      }
    }
    return expanded.filter((t, i, arr) => arr.indexOf(t) === i);
  }

  /**
   * 한국어+숫자 공백 정규화 등 검색 쿼리 변형 생성
   * "조폭 마누라2" → ["조폭 마누라2", "조폭 마누라 2"]
   */
  private expandSearchQueries(candidates: string[]): string[] {
    const expanded: string[] = [];
    for (const candidate of candidates) {
      expanded.push(candidate);
      // 한글 뒤에 바로 숫자가 오는 경우 공백 삽입 변형 추가
      const spaced = candidate.replace(/([가-힣])(\d)/g, '$1 $2');
      if (spaced !== candidate && !expanded.includes(spaced)) {
        expanded.push(spaced);
      }
    }
    return expanded;
  }

  /**
   * 제목 후보 또는 설명에서 연도 힌트 추출
   */
  private extractYearHint(titleCandidates: string[], description?: string): string | null {
    // 제목 후보에서 연도 패턴 추출 (예: "인셉션 2010", "제목(2023)")
    for (const candidate of titleCandidates) {
      const yearMatch = candidate.match(/\(?(\d{4})\)?/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        if (year >= 1900 && year <= 2030) {
          return yearMatch[1];
        }
      }
    }

    // 설명에서 연도 패턴 추출
    if (description) {
      const descYearMatch = description.match(/\((\d{4})\)/);
      if (descYearMatch) {
        const year = parseInt(descYearMatch[1], 10);
        if (year >= 1900 && year <= 2030) {
          return descYearMatch[1];
        }
      }
    }

    return null;
  }

  private async determinePrimaryStatus(
    existingVideos: Video[],
    includesEnding: boolean,
    newVideoRuntime: number,
  ): Promise<boolean> {
    if (existingVideos.length === 0) {
      this.logger.log(`  First video for content → isPrimary: true`);
      return true;
    }

    const currentPrimary = existingVideos.find((v) => v.isPrimary);

    if (!currentPrimary) {
      this.logger.log(`  No primary video exists → isPrimary: true`);
      return true;
    }

    const newHasEnding = includesEnding;
    const currentHasEnding = currentPrimary.includesEnding;

    if (newHasEnding && !currentHasEnding) {
      await this.videoRepository.updatePrimaryStatus(currentPrimary.id, false);
      this.logger.log(`  결말포함 우선 → isPrimary: true`);
      return true;
    }

    if (!newHasEnding && currentHasEnding) {
      this.logger.log(`  기존 영상이 결말포함 → isPrimary: false`);
      return false;
    }

    const currentRuntime = currentPrimary.runtime ?? 0;
    if (newVideoRuntime > currentRuntime) {
      await this.videoRepository.updatePrimaryStatus(currentPrimary.id, false);
      this.logger.log(
        `  런타임 비교 (${newVideoRuntime}분 > ${currentRuntime}분) → isPrimary: true`,
      );
      return true;
    }

    this.logger.log(
      `  런타임 비교 (${newVideoRuntime}분 <= ${currentRuntime}분) → isPrimary: false`,
    );
    return false;
  }

  /**
   * 채널 조회 또는 생성 (메타데이터 포함)
   * 새 채널인 경우 YouTube에서 메타데이터를 가져와서 저장
   */
  private async getOrCreateChannelWithMetadata(
    channelId: string,
    channelName: string,
  ): Promise<string> {
    const exists = await this.channelRepository.exists(channelId);

    if (exists) {
      return channelId;
    }

    // 새 채널: 메타데이터 가져오기
    this.logger.log(`  New channel detected, fetching metadata: ${channelId}`);

    try {
      const metadata = await this.youtubeExtractor.getChannelMetadata(channelId);

      const channel = Channel.create({
        id: channelId,
        name: metadata.name || channelName || 'Unknown Channel',
        handleId: metadata.handleId || channelId,
        logoUrl: metadata.logoUrl,
        bannerUrl: metadata.bannerUrl,
        subscriberCount: metadata.subscriberCount,
      });

      await this.channelRepository.save(channel);
      this.logger.log(`  Channel saved: ${metadata.name} (${metadata.subscriberCount?.toLocaleString()} subscribers)`);

      return channelId;
    } catch (error) {
      this.logger.warn(`  Failed to fetch channel metadata: ${(error as Error).message}`);
      // 폴백: 기본 정보로 저장
      return this.channelRepository.getOrCreate(channelId, channelName);
    }
  }
}
