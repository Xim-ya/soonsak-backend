import { FailedVideo } from '../entities/failed-video.entity';

/**
 * 실패한 비디오 리포지토리 인터페이스
 */
export interface IFailedVideoRepository {
  /**
   * 비디오 ID로 실패 기록 조회
   */
  findByVideoId(videoId: string): Promise<FailedVideo | null>;

  /**
   * 재시도 가능한 실패 비디오 목록 조회 (retry_count < 3)
   */
  findRetryable(): Promise<FailedVideo[]>;

  /**
   * 영구 실패한 비디오 ID 목록 조회
   */
  findPermanentlyFailedIds(): Promise<string[]>;

  /**
   * 실패 비디오 저장 (upsert)
   */
  save(failedVideo: FailedVideo): Promise<void>;

  /**
   * 비디오 ID로 실패 기록 삭제 (성공 시 호출)
   */
  deleteByVideoId(videoId: string): Promise<void>;

  /**
   * 비디오 ID가 영구 실패 목록에 있는지 확인
   */
  isPermanentlyFailed(videoId: string): Promise<boolean>;

  /**
   * 여러 비디오 ID 중 영구 실패한 ID 목록 반환
   */
  filterPermanentlyFailed(videoIds: string[]): Promise<string[]>;

  /**
   * 최근 실패한 비디오 목록 조회 (슬랙 알림용)
   */
  findRecentFailures(limit?: number): Promise<FailedVideo[]>;
}
