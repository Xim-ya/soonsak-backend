/**
 * YouTube 비디오 ID 값 객체
 */
export class VideoId {
  private readonly value: string;

  private constructor(id: string) {
    this.value = id;
  }

  static create(id: string): VideoId {
    if (!id || id.trim().length === 0) {
      throw new Error('VideoId cannot be empty');
    }

    const trimmed = id.trim();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      throw new Error(`Invalid YouTube video ID format: ${id}`);
    }

    return new VideoId(trimmed);
  }

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
