import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS } from '@/shared/constants';
import { IVideoRepository } from '@/domain/repositories';
import { IYouTubeExtractorPort } from '@/application/ports';
import { ProcessVideoUseCase } from '../process-video';
import {
  RegisterChannelVideosInput,
  RegisterChannelVideosResult,
} from './register-channel-videos.dto';

/**
 * 채널 비디오 일괄 등록 Use Case
 * 채널의 모든 비디오를 순차적으로 등록
 */
@Injectable()
export class RegisterChannelVideosUseCase {
  private readonly logger = new Logger(RegisterChannelVideosUseCase.name);

  constructor(
    @Inject(INJECTION_TOKENS.YOUTUBE_EXTRACTOR)
    private readonly youtubeExtractor: IYouTubeExtractorPort,
    @Inject(INJECTION_TOKENS.VIDEO_REPOSITORY)
    private readonly videoRepository: IVideoRepository,
    private readonly processVideoUseCase: ProcessVideoUseCase,
  ) {}

  async execute(input: RegisterChannelVideosInput): Promise<RegisterChannelVideosResult> {
    const { channelId, maxVideos = 100 } = input;
    this.logger.log(`Registering all videos for channel: ${channelId}`);

    const result: RegisterChannelVideosResult = {
      channelId,
      channelName: '',
      totalVideos: 0,
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    try {
      const videos = await this.youtubeExtractor.getChannelVideos(channelId, maxVideos);
      result.totalVideos = videos.length;

      this.logger.log(`Found ${videos.length} videos to process`);

      const existingVideoIds = await this.getExistingVideoIds(
        videos.map((v) => v.videoId),
      );

      for (const video of videos) {
        if (existingVideoIds.has(video.videoId)) {
          result.skippedCount++;
          continue;
        }

        result.processedCount++;

        try {
          const processResult = await this.processVideoUseCase.execute({
            videoId: video.videoId,
            title: video.title,
            description: '',
            publishedAt: video.publishedAt,
            updatedAt: new Date().toISOString(),
            channelId,
            channelName: '',
            thumbnail: video.thumbnail,
            viewCount: video.viewCount,
          });

          if (!result.channelName && processResult.data) {
            result.channelName = channelId;
          }

          if (processResult.success) {
            result.successCount++;
            this.logger.log(`  [${result.successCount}/${result.totalVideos}] ${video.title}`);
          } else {
            if (processResult.message === '이미 처리된 동영상입니다') {
              result.skippedCount++;
              result.processedCount--;
            } else {
              result.failedCount++;
              result.errors.push(`${video.videoId}: ${processResult.message}`);
            }
          }
        } catch (error) {
          result.failedCount++;
          result.errors.push(`${video.videoId}: ${(error as Error).message}`);
        }
      }

      this.logger.log(
        `Channel registration completed: ${result.successCount} success, ${result.failedCount} failed, ${result.skippedCount} skipped`,
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
