/**
 * 채널 비디오 일괄 등록 입력 DTO
 */
export interface RegisterChannelVideosInput {
  channelId: string;
  maxVideos?: number;
}

/**
 * 채널 비디오 일괄 등록 결과 DTO
 */
export interface RegisterChannelVideosResult {
  channelId: string;
  channelName: string;
  totalVideos: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errors: string[];
}
