import { ContentTypeValue } from '@/domain/value-objects';

/**
 * 비디오 처리 결과 응답 DTO
 */
export interface VideoProcessingResponseDto {
  success: boolean;
  message: string;
  data?: {
    videoId: string;
    youtubeTitle: string;
    tmdbTitle: string;
    tmdbType: ContentTypeValue;
    tmdbId: number;
    includesEnding: boolean;
    contentId: number;
  };
}

/**
 * 채널 처리 결과 응답 DTO
 */
export interface ChannelProcessingResponseDto {
  channelId: string;
  channelName: string;
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errors: string[];
}

/**
 * 채널 비디오 일괄 등록 결과 응답 DTO
 */
export interface RegisterChannelVideosResponseDto {
  channelId: string;
  channelName: string;
  totalVideos: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errors: string[];
}

