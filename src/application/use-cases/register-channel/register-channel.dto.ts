/**
 * 채널 등록 입력 DTO
 */
export interface RegisterChannelInput {
  channelId: string;
  maxVideos?: number;
  /**
   * 영상 게시일 기준 최소 경과 시간 (시간 단위)
   * 이 시간보다 최근에 게시된 영상은 필터링됨
   * 예: 25시간 설정 시, 게시 후 25시간 이상 지난 영상만 처리
   */
  minAgeHours?: number;
}

/**
 * 채널 등록 결과 DTO
 */
export interface RegisterChannelResult {
  channelId: string;
  channelName: string;
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  skippedShortsCount: number;
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
  totalSkippedShorts: number;
  channelResults: RegisterChannelResult[];
  errors: string[];
}
