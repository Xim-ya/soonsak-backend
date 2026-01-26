import { ContentTypeValue } from '@/domain/value-objects';

/**
 * 비디오 처리 입력 DTO
 */
export interface ProcessVideoInput {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  channelId: string;
  channelName: string;
  thumbnail: string;
  viewCount?: number;
}

/**
 * 비디오 처리 결과 DTO
 */
export interface ProcessVideoResult {
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
 * TMDB 후보 DTO
 */
export interface TMDBCandidateDTO {
  type: ContentTypeValue;
  data: {
    id: number;
    title?: string;
    name?: string;
    originalTitle?: string;
    originalName?: string;
    releaseDate?: string;
    firstAirDate?: string;
    overview: string;
    posterPath?: string;
    popularity: number;
    voteAverage: number;
  };
  confidence?: number;
  searchTerm?: string;
}
