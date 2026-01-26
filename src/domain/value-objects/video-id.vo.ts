/**
 * YouTube 비디오 ID 값 객체
 *
 * @example
 * // 외부 입력(사용자, API 요청 등)에는 create() 사용
 * const videoId = VideoId.create(userInput);
 *
 * // DB 조회 등 신뢰할 수 있는 소스에는 fromString() 사용
 * const videoId = VideoId.fromString(dbRecord.videoId);
 */
export class VideoId {
  private static readonly YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

  private readonly value: string;

  private constructor(id: string) {
    this.value = id;
  }

  /**
   * 외부 입력으로부터 VideoId를 생성합니다.
   * 형식 검증을 수행하며, 유효하지 않은 경우 예외를 발생시킵니다.
   *
   * @param id - 검증할 YouTube 비디오 ID
   * @throws Error - ID가 비어있거나 형식이 유효하지 않은 경우
   */
  static create(id: string): VideoId {
    if (!id || id.trim().length === 0) {
      throw new Error('VideoId cannot be empty');
    }

    const trimmed = id.trim();
    if (!VideoId.YOUTUBE_VIDEO_ID_PATTERN.test(trimmed)) {
      throw new Error(`Invalid YouTube video ID format: ${id}`);
    }

    return new VideoId(trimmed);
  }

  /**
   * 신뢰할 수 있는 소스(DB, 내부 시스템 등)로부터 VideoId를 생성합니다.
   * 검증을 건너뛰어 성능을 최적화합니다.
   *
   * @param id - 이미 검증된 YouTube 비디오 ID
   * @remarks 외부 입력에는 반드시 create()를 사용하세요.
   */
  static fromString(id: string): VideoId {
    return new VideoId(id);
  }

  getValue(): string {
    return this.value;
  }

  equals(other: VideoId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
