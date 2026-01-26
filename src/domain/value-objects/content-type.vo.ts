/**
 * 콘텐츠 타입 값 객체 (영화/TV)
 */
export type ContentTypeValue = 'movie' | 'tv';

export class ContentType {
  private readonly value: ContentTypeValue;

  private constructor(type: ContentTypeValue) {
    this.value = type;
  }

  static movie(): ContentType {
    return new ContentType('movie');
  }

  static tv(): ContentType {
    return new ContentType('tv');
  }

  static fromString(type: string): ContentType {
    if (type !== 'movie' && type !== 'tv') {
      throw new Error(`Invalid content type: ${type}`);
    }
    return new ContentType(type);
  }

  getValue(): ContentTypeValue {
    return this.value;
  }

  isMovie(): boolean {
    return this.value === 'movie';
  }

  isTV(): boolean {
    return this.value === 'tv';
  }

  equals(other: ContentType): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
