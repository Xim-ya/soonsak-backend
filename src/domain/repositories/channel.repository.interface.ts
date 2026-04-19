import { Channel } from '../entities/channel.entity';

/**
 * 채널 리포지토리 인터페이스
 */
export interface IChannelRepository {
  /**
   * 모든 채널 조회
   */
  findAll(): Promise<Channel[]>;

  /**
   * 채널 ID로 조회
   */
  findById(id: string): Promise<Channel | null>;

  /**
   * 채널 저장 (upsert)
   */
  save(channel: Channel): Promise<void>;

  /**
   * 채널 ID로 존재 여부 확인
   */
  exists(id: string): Promise<boolean>;

  /**
   * 채널 조회 또는 생성
   * @returns 채널 ID
   */
  getOrCreate(id: string, name: string): Promise<string>;

  /**
   * 채널 비활성화 (크론 대상에서 제외)
   * 탭 구조 불가·빈 채널 등 영구적으로 추출이 불가능한 경우 사용
   */
  markInactive(id: string, reason: string): Promise<void>;
}
