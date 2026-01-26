/**
 * TMDB ID 값 객체
 */
export class TMDBId {
  private readonly value: number;

  private constructor(id: number) {
    this.value = id;
  }

  static create(id: number): TMDBId {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Invalid TMDB ID: ${id}`);
    }

    return new TMDBId(id);
  }

  static fromNumber(id: number): TMDBId {
    return new TMDBId(id);
  }

  getValue(): number {
    return this.value;
  }

  equals(other: TMDBId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value.toString();
  }
}
