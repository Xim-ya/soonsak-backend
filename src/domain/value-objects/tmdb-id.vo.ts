/**
 * TMDB ID 값 객체
 *
 * @example
 * // 외부 입력(사용자, API 요청 등)에는 create() 사용
 * const tmdbId = TMDBId.create(userInput);
 *
 * // DB 조회 등 신뢰할 수 있는 소스에는 fromNumber() 사용
 * const tmdbId = TMDBId.fromNumber(dbRecord.tmdbId);
 */
export class TMDBId {
  private readonly value: number;

  private constructor(id: number) {
    this.value = id;
  }

  /**
   * 외부 입력으로부터 TMDBId를 생성합니다.
   * 형식 검증을 수행하며, 유효하지 않은 경우 예외를 발생시킵니다.
   *
   * @param id - 검증할 TMDB ID (양의 정수)
   * @throws Error - ID가 양의 정수가 아닌 경우
   */
  static create(id: number): TMDBId {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Invalid TMDB ID: ${id}`);
    }

    return new TMDBId(id);
  }

  /**
   * 신뢰할 수 있는 소스(DB, 내부 시스템 등)로부터 TMDBId를 생성합니다.
   * 검증을 건너뛰어 성능을 최적화합니다.
   *
   * @param id - 이미 검증된 TMDB ID
   * @remarks 외부 입력에는 반드시 create()를 사용하세요.
   */
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
