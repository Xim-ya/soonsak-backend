import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS } from '@/shared/constants';
import { IVideoRepository, IChannelRepository } from '@/domain/repositories';
import { IYouTubeExtractorPort } from '@/application/ports';
import { Channel } from '@/domain/entities';
import { RegisterVideoUseCase } from '../register-video';
import {
  RegisterChannelVideosInput,
  RegisterChannelVideosResult,
} from './register-channel-videos.dto';

/** API 레이트 리미팅 방지를 위한 딜레이 (밀리초) */
const VIDEO_PROCESSING_DELAY_MS = 2000;

/** 딜레이 헬퍼 */
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 채널 비디오 일괄 등록 Use Case
 * 채널 등록 + 모든 비디오를 순차적으로 등록
 */
@Injectable()
export class RegisterChannelVideosUseCase {
  private readonly logger = new Logger(RegisterChannelVideosUseCase.name);

  constructor(
    @Inject(INJECTION_TOKENS.YOUTUBE_EXTRACTOR)
    private readonly youtubeExtractor: IYouTubeExtractorPort,
    @Inject(INJECTION_TOKENS.VIDEO_REPOSITORY)
    private readonly videoRepository: IVideoRepository,
    @Inject(INJECTION_TOKENS.CHANNEL_REPOSITORY)
    private readonly channelRepository: IChannelRepository,
    private readonly registerVideoUseCase: RegisterVideoUseCase,
  ) {}

  async execute(input: RegisterChannelVideosInput): Promise<RegisterChannelVideosResult> {
    const { channelId, maxVideos = 100 } = input;
    this.logger.log(`Registering channel and all videos: ${channelId}`);

    const result: RegisterChannelVideosResult = {
      channelId,
      channelName: '',
      totalVideos: 0,
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      skippedShortsCount: 0,
      errors: [],
    };

    try {
      // 1. 채널 메타데이터 수집 및 저장
      const channelMetadata = await this.youtubeExtractor.getChannelMetadata(channelId);
      result.channelId = channelMetadata.id; // 실제 채널 ID로 업데이트 (@handle → UC...)
      result.channelName = channelMetadata.name;

      this.logger.log(`Channel metadata fetched: ${channelMetadata.name} (${channelMetadata.id})`);

      // 2. 채널 DB 저장/업데이트
      const channel = Channel.create({
        id: channelMetadata.id,
        name: channelMetadata.name,
        handleId: channelMetadata.handleId || channelMetadata.id,
        logoUrl: channelMetadata.logoUrl,
        bannerUrl: channelMetadata.bannerUrl,
        subscriberCount: channelMetadata.subscriberCount,
      });
      await this.channelRepository.save(channel);
      this.logger.log(`Channel saved to DB: ${channelMetadata.name}`);

      // 3. 채널 영상 목록 조회
      const videos = await this.youtubeExtractor.getChannelVideos(channelMetadata.id, maxVideos);
      result.totalVideos = videos.length;

      this.logger.log(`Found ${videos.length} videos to process`);

      // 4. 이미 등록된 영상 필터링
      const existingVideoIds = await this.getExistingVideoIds(
        videos.map((v) => v.videoId),
      );

      // 5. 영상 순차 등록
      for (const video of videos) {
        if (existingVideoIds.has(video.videoId)) {
          result.skippedCount++;
          continue;
        }

        result.processedCount++;

        try {
          const registerResult = await this.registerVideoUseCase.execute({
            videoId: video.videoId,
            title: video.title,
            description: '',
            publishedAt: video.publishedAt,
            updatedAt: new Date().toISOString(),
            channelId: channelMetadata.id,
            channelName: channelMetadata.name,
            thumbnail: video.thumbnail,
            viewCount: video.viewCount,
          });

          if (registerResult.success) {
            result.successCount++;
            this.logger.log(`  [${result.successCount}/${result.totalVideos}] ${video.title}`);
          } else {
            if (registerResult.message === '이미 처리된 동영상입니다') {
              result.skippedCount++;
              result.processedCount--;
            } else if (registerResult.message === '쇼츠 영상은 등록 대상이 아닙니다') {
              result.skippedShortsCount++;
              result.processedCount--;
            } else {
              result.failedCount++;
              result.errors.push(`${video.videoId}: ${registerResult.message}`);
            }
          }
        } catch (error) {
          result.failedCount++;
          result.errors.push(`${video.videoId}: ${(error as Error).message}`);
        }

        // API 레이트 리미팅 방지를 위한 딜레이
        await delay(VIDEO_PROCESSING_DELAY_MS);
      }

      this.logger.log(
        `Channel registration completed: ${result.successCount} success, ${result.failedCount} failed, ${result.skippedCount} skipped, ${result.skippedShortsCount} shorts`,
      );
    } catch (error) {
      result.errors.push(`Channel error: ${(error as Error).message}`);
      this.logger.error(`Channel registration failed: ${(error as Error).message}`);
    }

    return result;
  }

  private async getExistingVideoIds(videoIds: string[]): Promise<Set<string>> {
    try {
      const existingIds = await this.videoRepository.findExistingIds(videoIds);
      return new Set(existingIds);
    } catch {
      return new Set();
    }
  }
}
