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
 * 배치 처리 결과 응답 DTO
 */
export interface BatchProcessingResponseDto {
  startedAt: string;
  completedAt: string;
  totalChannels: number;
  totalVideosProcessed: number;
  totalSuccess: number;
  totalFailed: number;
  channelResults: ChannelProcessingResponseDto[];
  errors: string[];
}

/**
 * 스케줄러 상태 응답 DTO
 */
export interface SchedulerStatusResponseDto {
  lastRunAt: string | null;
  isRunning: boolean;
  processedChannels: number;
  processedVideos: number;
  newVideosFound: number;
  errors: string[];
}
