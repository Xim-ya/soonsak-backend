import { ContentType } from './tmdb.types';

/**
 * 채널 엔티티
 */
export interface ChannelEntity {
  id: string;
  name: string;
  handleId: string;
  logoUrl?: string;
  lastProcessedAt?: Date;
}

/**
 * 비디오 엔티티
 */
export interface VideoEntity {
  id: string;
  contentId: number;
  contentType: ContentType;
  title: string;
  runtime?: number;
  thumbnailUrl?: string;
  isPrimary: boolean;
  channelId?: string;
  includesEnding: boolean;
  uploadedAt: string;
  updatedAt: string;
}

/**
 * 콘텐츠 엔티티 (TMDB 정보)
 */
export interface ContentEntity {
  id: number;
  contentType: ContentType;
  title: string;
  posterPath?: string;
  uploadedAt?: string;
}

/**
 * 비디오 + 콘텐츠 관계
 */
export interface VideoWithContent extends VideoEntity {
  content?: ContentEntity;
}

/**
 * 비디오 처리 결과
 */
export interface VideoProcessingResult {
  success: boolean;
  message: string;
  data?: {
    videoId: string;
    youtubeTitle: string;
    tmdbTitle: string;
    tmdbType: ContentType;
    tmdbId: number;
    includesEnding: boolean;
    contentId: number;
  };
}

/**
 * 스케줄러 작업 상태
 */
export interface SchedulerJobStatus {
  lastRunAt: Date | null;
  isRunning: boolean;
  processedChannels: number;
  processedVideos: number;
  newVideosFound: number;
  errors: string[];
}
