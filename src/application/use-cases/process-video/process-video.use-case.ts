import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS } from '@/shared/constants';
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
import { ProcessVideoInput, ProcessVideoResult, TMDBCandidateDTO } from './process-video.dto';
import { delay } from '@/shared/utils';

/**
 * 비디오 처리 Use Case
 * 핵심 비디오 처리 로직: YouTube 추출, TMDB 매칭, 데이터베이스 저장
 */
@Injectable()
export class ProcessVideoUseCase {
  private readonly logger = new Logger(ProcessVideoUseCase.name);

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

  async execute(input: ProcessVideoInput): Promise<ProcessVideoResult> {
    const { videoId, title } = input;
    this.logger.log(`Processing video: ${title} (${videoId})`);

    try {
      const exists = await this.videoRepository.exists(VideoId.fromString(videoId));
      if (exists) {
        return {
          success: false,
          message: '이미 처리된 동영상입니다',
        };
      }

      const videoInfo = await this.youtubeExtractor.getVideoInfo(videoId);
      this.logger.log(`  Video duration: ${Math.round(videoInfo.duration / 60)}분`);

      const titleCandidates = this.titleExtractionService.extractCandidates(
        videoInfo.title,
        videoInfo.description,
      );
      this.logger.log(`  Title candidates: ${titleCandidates.join(', ')}`);

      const tmdbCandidates = await this.searchTMDBCandidates(titleCandidates);

      const shouldRunAI = tmdbCandidates.length === 0 || tmdbCandidates.length <= 3;

      if (shouldRunAI) {
        await this.enrichWithAIAnalysis(
          videoId,
          videoInfo.duration,
          tmdbCandidates,
        );
      }

      if (tmdbCandidates.length === 0) {
        return {
          success: false,
          message: 'TMDB 매칭 실패 - 검색결과 없음',
        };
      }

      let selectedMatch: TMDBMatchResult | null = null;
      let includesEnding = this.endingDetectionService.detectFromContent(
        videoInfo.title,
        videoInfo.description,
      );

      if (tmdbCandidates.length > 0) {
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

          this.logger.log(`  AI analysis: ${includesEnding ? '결말포함' : '결말없음'}`);
        } catch (error) {
          this.logger.warn('  AI analysis failed, using first candidate');
        }
      }

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
        message: '동영상 처리 완료',
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
      this.logger.error(`  Processing failed: ${(error as Error).message}`);
      return {
        success: false,
        message: `처리 실패: ${(error as Error).message}`,
      };
    }
  }

  private async searchTMDBCandidates(
    titleCandidates: string[],
  ): Promise<TMDBMatchResult[]> {
    const tmdbCandidates: TMDBMatchResult[] = [];
    const searchResults: string[] = [];

    for (const candidate of titleCandidates.slice(0, 5)) {
      if (candidate.length < 2 || candidate.length > 30) continue;

      try {
        const results = await this.contentSearch.searchMulti(candidate);
        searchResults.push(`${candidate}:${results.length}`);
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
      } catch (err) {
        searchResults.push(`${candidate}:ERR`);
      }
      await delay(100);
    }

    this.logger.log(
      `  Found ${tmdbCandidates.length} TMDB candidates (${searchResults.join(', ')})`,
    );

    return tmdbCandidates;
  }

  private async enrichWithAIAnalysis(
    videoId: string,
    duration: number,
    tmdbCandidates: TMDBMatchResult[],
  ): Promise<void> {
    this.logger.log(`  AI 자막 분석 실행 (패턴 후보: ${tmdbCandidates.length}개)...`);

    try {
      const aiAnalysis = await this.aiAnalyzer.analyzeVideoContent({
        videoId,
        videoDuration: duration,
        tmdbCandidates: [],
      });

      this.logger.log(
        `  AI 분석 결과: ${JSON.stringify({
          extractedTitles: aiAnalysis.extractedTitles,
          includesEnding: aiAnalysis.includesEnding,
          confidence: aiAnalysis.confidence,
        })}`,
      );

      const minConfidence = 70;
      const extractedTitles = aiAnalysis.extractedTitles || [];
      if (aiAnalysis.confidence >= minConfidence && extractedTitles.length > 0) {
        this.logger.log(`  AI 추출 제목: ${extractedTitles.join(', ')}`);

        for (const aiTitle of extractedTitles.slice(0, 3)) {
          if (aiTitle.length < 2 || aiTitle.length > 30) continue;

          try {
            const results = await this.contentSearch.searchMulti(aiTitle);
            for (const result of results) {
              if (!tmdbCandidates.find((c) => c.data.id === result.data.id)) {
                tmdbCandidates.unshift({
                  type: result.type,
                  data: result.data,
                  confidence: aiAnalysis.confidence,
                  searchTerm: `AI:${aiTitle}`,
                });
              }
            }
          } catch {
            // 다음 제목으로 계속 진행
          }
          await delay(100);
        }

        this.logger.log(`  AI 추가 후 TMDB candidates: ${tmdbCandidates.length}`);
      }
    } catch (error) {
      this.logger.warn(`  AI 자막 분석 실패: ${(error as Error).message}`);
    }
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
