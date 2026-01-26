import { ChannelProcessingResponseDto } from './video-processing.response.dto';

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
 * 배치 상태 응답 DTO
 */
export interface BatchStatusResponseDto {
  lastRunAt: string | null;
  isRunning: boolean;
  processedChannels: number;
  processedVideos: number;
  newVideosFound: number;
  errors: string[];
}
