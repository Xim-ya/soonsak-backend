import { Content } from '../entities/content.entity';
import { TMDBId } from '../value-objects';

/**
 * 콘텐츠 리포지토리 인터페이스
 */
export interface IContentRepository {
  /**
   * 콘텐츠 ID로 조회
   */
  findById(id: TMDBId): Promise<Content | null>;

  /**
   * 콘텐츠 저장 (upsert)
   * @returns 저장된 콘텐츠의 ID
   */
  save(content: Content): Promise<number>;

  /**
   * 콘텐츠 ID로 존재 여부 확인
   */
  exists(id: TMDBId): Promise<boolean>;
}
