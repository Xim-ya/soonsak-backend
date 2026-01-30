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
  ContentMatchResult,
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

      const titleCandidates = this.titleExtractionService.extractCandidates(
        videoInfo.title,
        videoInfo.description,
      );
      this.logger.log(`  Title candidates: ${titleCandidates.join(', ')}`);

      // 1. TMDB 병렬 검색
      const tmdbCandidates = await this.searchTMDBCandidatesParallel(titleCandidates, videoInfo.description);

      // 2. 고신뢰도 매칭 체크 (AI 스킵 가능 여부)
      const highConfidenceMatch = this.findHighConfidenceMatch(tmdbCandidates, titleCandidates);

      let selectedMatch: TMDBMatchResult | null = null;
      let includesEnding = this.endingDetectionService.detectFromContent(
        videoInfo.title,
        videoInfo.description,
      );

      if (highConfidenceMatch) {
        // 고신뢰도 매칭 → AI 스킵
        this.logger.log(`  [MATCH] High confidence → ${highConfidenceMatch.data.title || highConfidenceMatch.data.name} (id=${highConfidenceMatch.data.id}, path=high-confidence)`);
        selectedMatch = highConfidenceMatch;
      } else if (tmdbCandidates.length > 0) {
        // 3. AI 통합 분석 (1회 호출로 제목 추출 + TMDB 선택 + 결말 판단)
        this.logger.log(`  Running unified AI analysis...`);
        try {
          const analysis = await this.aiAnalyzer.analyzeVideoContent({
            videoId,
            videoDuration: videoInfo.duration,
            tmdbCandidates: this.toContentMatchResults(tmdbCandidates),
          });

          includesEnding = analysis.includesEnding;

          if (analysis.selectedTMDBMatch) {
            selectedMatch =
              tmdbCandidates.find(
                (c) => c.data.id === analysis.selectedTMDBMatch?.tmdbId,
              ) || null;
            if (selectedMatch) {
              this.logger.log(`  [MATCH] AI selected → ${selectedMatch.data.title || selectedMatch.data.name} (id=${selectedMatch.data.id}, confidence=${analysis.selectedTMDBMatch.confidence}, path=ai)`);
            }
          }

          // AI가 추출한 제목으로 추가 검색 (기존 후보에 없을 경우)
          if (!selectedMatch && analysis.extractedTitles?.length) {
            const additionalCandidates = await this.searchTMDBCandidatesParallel(
              analysis.extractedTitles.slice(0, 2),
            );
            if (additionalCandidates.length > 0) {
              tmdbCandidates.unshift(...additionalCandidates);
              selectedMatch = additionalCandidates[0];
            }
          }

          this.logger.log(`  AI analysis: ${includesEnding ? '결말포함' : '결말없음'}`);
        } catch (error) {
          const errorMessage = error instanceof AIAnalysisError
            ? error.message
            : (error as Error).message;
          this.logger.warn(`  AI analysis failed: ${errorMessage}`);
        }
      }

      // 후보가 없으면 AI로 제목 추출 시도
      if (tmdbCandidates.length === 0) {
        this.logger.log(`  No TMDB candidates, trying AI title extraction...`);
        try {
          const analysis = await this.aiAnalyzer.analyzeVideoContent({
            videoId,
            videoDuration: videoInfo.duration,
            tmdbCandidates: [],
          });

          if (analysis.extractedTitles?.length) {
            const aiCandidates = await this.searchTMDBCandidatesParallel(
              analysis.extractedTitles.slice(0, 3),
            );
            tmdbCandidates.push(...aiCandidates);
            includesEnding = analysis.includesEnding;
          }
        } catch (error) {
          const errorMessage = error instanceof AIAnalysisError
            ? error.message
            : (error as Error).message;
          this.logger.debug(`AI title extraction failed: ${errorMessage}`);
        }
      }

      if (tmdbCandidates.length === 0) {
        return {
          success: false,
          message: MESSAGES.TMDB.MATCH_FAILED_NO_RESULTS,
        };
      }

      // 4. 최종 선택
      if (!selectedMatch) {
        const scores = this.primaryVideoSelectionService.getCandidateScores(
          tmdbCandidates,
          titleCandidates,
          videoInfo.description,
        );
        this.logger.log(`  [MATCH] Scoring fallback (${scores.length} candidates):`);
        scores
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .forEach(({ candidate, score }) => {
            const name = candidate.data.title || candidate.data.name;
            this.logger.log(`    → ${name} (id=${candidate.data.id}, score=${score})`);
          });

        selectedMatch = this.primaryVideoSelectionService.selectBestCandidate(
          tmdbCandidates,
          titleCandidates,
          videoInfo.description,
        );
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

    // 병렬로 모든 검색 실행
    const searchPromises = validCandidates.map(async (candidate) => {
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

  private toContentMatchResults(candidates: TMDBMatchResult[]): ContentMatchResult[] {
    return candidates.map((c) => ({
      type: c.type,
      data: {
        id: c.data.id,
        title: c.data.title,
        name: c.data.name,
        originalTitle: c.data.originalTitle,
        originalName: c.data.originalName,
        releaseDate: c.data.releaseDate,
        firstAirDate: c.data.firstAirDate,
        overview: c.data.overview,
        posterPath: c.data.posterPath,
        backdropPath: c.data.backdropPath,
        popularity: c.data.popularity,
        voteAverage: c.data.voteAverage,
        voteCount: c.data.voteCount,
        mediaType: c.type,
      },
      confidence: c.confidence,
      searchTerm: c.searchTerm,
    }));
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
