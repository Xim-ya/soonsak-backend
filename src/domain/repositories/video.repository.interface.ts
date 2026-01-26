import { Video } from '../entities/video.entity';
import { VideoId, TMDBId } from '../value-objects';

/**
 * 비디오 리포지토리 인터페이스
 */
export interface IVideoRepository {
  /**
   * 비디오 ID로 존재 여부 확인
   */
  exists(id: VideoId): Promise<boolean>;

  /**
   * 비디오 ID로 조회
   */
  findById(id: VideoId): Promise<Video | null>;

  /**
   * 콘텐츠 ID로 비디오 목록 조회
   */
  findByContentId(contentId: TMDBId): Promise<Video[]>;

  /**
   * 비디오 저장 (upsert)
   */
  save(video: Video): Promise<void>;

  /**
   * Primary 상태 업데이트
   */
  updatePrimaryStatus(id: VideoId, isPrimary: boolean): Promise<void>;

  /**
   * 콘텐츠 ID로 Primary 비디오 조회
   */
  findPrimaryByContentId(contentId: TMDBId): Promise<Video | null>;

  /**
   * 주어진 ID 목록 중 이미 존재하는 ID 조회
   */
  findExistingIds(videoIds: string[]): Promise<string[]>;
}
