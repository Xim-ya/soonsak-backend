import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS, MESSAGES, TMDB_CONFIG } from '@/shared/constants';
import { Video, Content } from '@/domain/entities';
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
      this.logger.log(`  Video duration: ${Math.round(videoInfo.duration / 60)}분`);

      const titleCandidates = this.titleExtractionService.extractCandidates(
        videoInfo.title,
        videoInfo.description,
      );
      this.logger.log(`  Title candidates: ${titleCandidates.join(', ')}`);

      // 1. TMDB 병렬 검색
      const tmdbCandidates = await this.searchTMDBCandidatesParallel(titleCandidates);

      // 2. 고신뢰도 매칭 체크 (AI 스킵 가능 여부)
      const highConfidenceMatch = this.findHighConfidenceMatch(tmdbCandidates, titleCandidates);

      let selectedMatch: TMDBMatchResult | null = null;
      let includesEnding = this.endingDetectionService.detectFromContent(
        videoInfo.title,
        videoInfo.description,
      );

      if (highConfidenceMatch) {
        // 고신뢰도 매칭 → AI 스킵
        this.logger.log(`  High confidence match found, skipping AI: ${highConfidenceMatch.data.title || highConfidenceMatch.data.name}`);
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
        selectedMatch = this.primaryVideoSelectionService.selectBestCandidate(
          tmdbCandidates,
          titleCandidates,
          videoInfo.description,
        );
      }

      const tmdbData = selectedMatch.data;
      const tmdbTitle = selectedMatch.type === 'movie' ? tmdbData.title : tmdbData.name;

      this.logger.log(`  Selected TMDB: ${tmdbTitle} (${selectedMatch.type})`);

      const channelId = await this.channelRepository.getOrCreate(
        videoInfo.channelId,
        videoInfo.channelTitle,
      );

      const content = Content.create({
        id: tmdbData.id,
        contentType: selectedMatch.type,
        title: tmdbTitle || '',
        posterPath: tmdbData.posterPath,
        uploadedAt: new Date().toISOString(),
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
  ): Promise<TMDBMatchResult[]> {
    const validCandidates = titleCandidates
      .slice(0, TMDB_CONFIG.MAX_CANDIDATES)
      .filter((c) => c.length >= TMDB_CONFIG.MIN_TITLE_LENGTH && c.length <= TMDB_CONFIG.MAX_TITLE_LENGTH);

    if (validCandidates.length === 0) {
      return [];
    }

    // 병렬로 모든 검색 실행
    const searchPromises = validCandidates.map(async (candidate) => {
      try {
        const results = await this.contentSearch.searchMulti(candidate);
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
   * 조건: TMDB 후보 1개 + 정확한 제목 매칭 + 높은 인기도
   * 이 조건을 만족하면 AI 호출 스킵 가능
   */
  private findHighConfidenceMatch(
    tmdbCandidates: TMDBMatchResult[],
    titleCandidates: string[],
  ): TMDBMatchResult | null {
    if (tmdbCandidates.length !== 1) {
      return null;
    }

    const candidate = tmdbCandidates[0];
    const tmdbTitle = (candidate.data.title || candidate.data.name || '').toLowerCase();
    const tmdbOriginalTitle = (candidate.data.originalTitle || candidate.data.originalName || '').toLowerCase();

    // 제목 정확히 매칭 체크
    const hasExactMatch = titleCandidates.some((title) => {
      const normalizedTitle = title.toLowerCase().trim();
      return (
        tmdbTitle === normalizedTitle ||
        tmdbOriginalTitle === normalizedTitle ||
        tmdbTitle.includes(normalizedTitle) ||
        tmdbOriginalTitle.includes(normalizedTitle)
      );
    });

    if (!hasExactMatch) {
      return null;
    }

    // 인기도 체크
    const popularity = candidate.data.popularity || 0;
    if (popularity < TMDB_CONFIG.MIN_POPULARITY_THRESHOLD) {
      return null;
    }

    return candidate;
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
}
