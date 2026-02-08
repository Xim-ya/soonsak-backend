import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS, MESSAGES } from '@/shared/constants';
import { IVideoRepository, IChannelRepository, IFailedVideoRepository } from '@/domain/repositories';
import { FailedVideo } from '@/domain/entities';
import { IRSSFeedPort, RSSFeedEntry } from '@/application/ports';
import { RegisterVideoUseCase } from '../register-video';
import { RegisterChannelInput, RegisterChannelResult, FailedVideoInfo } from './register-channel.dto';

/** 밀리초 단위 상수 */
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/** API 레이트 리미팅 방지를 위한 딜레이 (밀리초) */
const VIDEO_PROCESSING_DELAY_MS = 3000;

/** 딜레이 헬퍼 */
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 채널 등록 Use Case
 * 단일 채널의 최근 비디오 등록
 */
@Injectable()
export class RegisterChannelUseCase {
  private readonly logger = new Logger(RegisterChannelUseCase.name);

  constructor(
    @Inject(INJECTION_TOKENS.CHANNEL_REPOSITORY)
    private readonly channelRepository: IChannelRepository,
    @Inject(INJECTION_TOKENS.VIDEO_REPOSITORY)
    private readonly videoRepository: IVideoRepository,
    @Inject(INJECTION_TOKENS.FAILED_VIDEO_REPOSITORY)
    private readonly failedVideoRepository: IFailedVideoRepository,
    @Inject(INJECTION_TOKENS.RSS_FEED)
    private readonly rssFeed: IRSSFeedPort,
    private readonly registerVideoUseCase: RegisterVideoUseCase,
  ) {}

  async execute(input: RegisterChannelInput): Promise<RegisterChannelResult> {
    const { channelId, maxVideos = 15, minAgeHours } = input;
    this.logger.log(`Registering channel: ${channelId}`);

    const result: RegisterChannelResult = {
      channelId,
      channelName: '',
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      skippedShortsCount: 0,
      skippedPermanentlyFailedCount: 0,
      errors: [],
      failedVideos: [],
    };

    try {
      const recentVideos = await this.rssFeed.getRecentVideos(channelId, maxVideos);
      result.channelName = recentVideos[0]?.channelName || channelId;

      this.logger.log(`  Found ${recentVideos.length} recent videos`);

      // 최소 경과 시간 필터링 적용
      const filteredVideos = this.filterByMinAge(recentVideos, minAgeHours);
      if (minAgeHours && filteredVideos.length !== recentVideos.length) {
        const skippedByAge = recentVideos.length - filteredVideos.length;
        this.logger.log(`  Filtered out ${skippedByAge} videos (published within ${minAgeHours} hours)`);
      }

      const processedVideoIds = await this.getProcessedVideoIds(channelId);

      // 영구 실패한 비디오 ID 목록 조회
      const videoIds = filteredVideos.map((v) => v.videoId);
      const permanentlyFailedIds = await this.failedVideoRepository.filterPermanentlyFailed(videoIds);
      const permanentlyFailedSet = new Set(permanentlyFailedIds);

      for (const rssEntry of filteredVideos) {
        // 영구 실패한 비디오 스킵
        if (permanentlyFailedSet.has(rssEntry.videoId)) {
          result.skippedPermanentlyFailedCount++;
          this.logger.debug(`  Skipping permanently failed video: ${rssEntry.videoId}`);
          continue;
        }

        if (processedVideoIds.has(rssEntry.videoId)) {
          result.skippedCount++;
          continue;
        }

        result.processedCount++;

        try {
          const registerResult = await this.registerVideoUseCase.execute({
            videoId: rssEntry.videoId,
            title: rssEntry.title,
            description: rssEntry.description,
            publishedAt: rssEntry.publishedAt,
            updatedAt: rssEntry.updatedAt,
            channelId: rssEntry.channelId,
            channelName: rssEntry.channelName,
            thumbnail: rssEntry.thumbnail,
            viewCount: rssEntry.viewCount,
          });

          if (registerResult.success) {
            result.successCount++;
            // 성공 시 실패 기록 삭제 (재시도 성공 케이스)
            await this.failedVideoRepository.deleteByVideoId(rssEntry.videoId);
          } else {
            if (registerResult.message === MESSAGES.VIDEO.ALREADY_PROCESSED) {
              result.skippedCount++;
              result.processedCount--;
            } else if (registerResult.message === '쇼츠 영상은 등록 대상이 아닙니다') {
              result.skippedShortsCount++;
              result.processedCount--;
            } else {
              result.failedCount++;
              result.errors.push(`${rssEntry.videoId}: ${registerResult.message}`);
              // 실패 기록 저장
              const failedVideoInfo = await this.recordFailure(
                rssEntry.videoId,
                rssEntry.title,
                rssEntry.channelId,
                registerResult.message || 'Unknown error',
              );
              result.failedVideos.push(failedVideoInfo);
            }
          }
        } catch (error) {
          result.failedCount++;
          const errorMessage = (error as Error).message;
          result.errors.push(`${rssEntry.videoId}: ${errorMessage}`);
          // 실패 기록 저장
          const failedVideoInfo = await this.recordFailure(
            rssEntry.videoId,
            rssEntry.title,
            rssEntry.channelId,
            errorMessage,
          );
          result.failedVideos.push(failedVideoInfo);
        }

        // API 레이트 리미팅 방지를 위한 딜레이
        await delay(VIDEO_PROCESSING_DELAY_MS);
      }

      this.logger.log(
        `  Channel completed: ${result.successCount} success, ${result.failedCount} failed, ${result.skippedCount} skipped, ${result.skippedShortsCount} shorts, ${result.skippedPermanentlyFailedCount} perm-failed`,
      );
    } catch (error) {
      result.errors.push(`Channel error: ${(error as Error).message}`);
      this.logger.error(`  Channel registration failed: ${(error as Error).message}`);
    }

    return result;
  }

  /**
   * 실패 기록 저장/업데이트
   */
  private async recordFailure(
    videoId: string,
    title: string,
    channelId: string,
    failureReason: string,
  ): Promise<FailedVideoInfo> {
    try {
      const existing = await this.failedVideoRepository.findByVideoId(videoId);

      if (existing) {
        // 기존 실패 기록 업데이트 (재시도 횟수 증가)
        const updated = existing.incrementRetry().updateFailureReason(failureReason);
        await this.failedVideoRepository.save(updated);

        if (updated.isPermanentlyFailed) {
          this.logger.warn(`  Video permanently failed after ${updated.retryCount} attempts: ${videoId}`);
        }

        return {
          videoId,
          title,
          failureReason,
          retryCount: updated.retryCount,
          isNewFailure: false,
        };
      } else {
        // 새 실패 기록 생성
        const failedVideo = FailedVideo.create({
          videoId,
          title,
          channelId,
          failureReason,
        });
        await this.failedVideoRepository.save(failedVideo);

        return {
          videoId,
          title,
          failureReason,
          retryCount: 0,
          isNewFailure: true,
        };
      }
    } catch (error) {
      this.logger.error(`  Failed to record failure: ${(error as Error).message}`);
      return {
        videoId,
        title,
        failureReason,
        retryCount: 0,
        isNewFailure: true,
      };
    }
  }

  private async getProcessedVideoIds(channelId: string): Promise<Set<string>> {
    try {
      const channel = await this.channelRepository.findById(channelId);
      if (!channel) {
        return new Set();
      }

      const videoIds = await this.videoRepository.getRecentVideoIds(channelId, 50);
      return new Set(videoIds || []);
    } catch (error) {
      this.logger.debug(`Failed to get processed video IDs: ${(error as Error).message}`);
      return new Set();
    }
  }

  /**
   * 최소 경과 시간 기준으로 영상 필터링
   * @param videos RSS 피드 영상 목록
   * @param minAgeHours 최소 경과 시간 (시간 단위)
   * @returns 필터링된 영상 목록 (게시 후 minAgeHours 이상 지난 영상만)
   */
  private filterByMinAge(
    videos: RSSFeedEntry[],
    minAgeHours?: number,
  ): RSSFeedEntry[] {
    if (!minAgeHours || minAgeHours <= 0) {
      return videos;
    }

    const now = Date.now();
    const minAgeMilliseconds = minAgeHours * MILLISECONDS_PER_HOUR;

    return videos.filter((video) => {
      const publishedAt = new Date(video.publishedAt).getTime();
      const ageMilliseconds = now - publishedAt;
      return ageMilliseconds >= minAgeMilliseconds;
    });
  }
}
