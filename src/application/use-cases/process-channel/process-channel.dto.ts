/**
 * 채널 처리 입력 DTO
 */
export interface ProcessChannelInput {
  channelId: string;
  maxVideos?: number;
}

/**
 * 채널 처리 결과 DTO
 */
export interface ProcessChannelResult {
  channelId: string;
  channelName: string;
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errors: string[];
}

/**
 * 배치 처리 결과 DTO
 */
export interface BatchProcessResult {
  startedAt: Date;
  completedAt: Date;
  totalChannels: number;
  totalVideosProcessed: number;
  totalSuccess: number;
  totalFailed: number;
  channelResults: ProcessChannelResult[];
  errors: string[];
}
