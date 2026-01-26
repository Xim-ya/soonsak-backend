/**
 * 신뢰도 점수 값 객체 (0-100)
 */
export class ConfidenceScore {
  private readonly value: number;

  private constructor(score: number) {
    this.value = score;
  }

  static create(score: number): ConfidenceScore {
    if (score < 0 || score > 100) {
      throw new Error(`Confidence score must be between 0 and 100: ${score}`);
    }
    return new ConfidenceScore(Math.round(score));
  }

  static zero(): ConfidenceScore {
    return new ConfidenceScore(0);
  }

  static full(): ConfidenceScore {
    return new ConfidenceScore(100);
  }

  getValue(): number {
    return this.value;
  }

  isHighConfidence(threshold = 70): boolean {
    return this.value >= threshold;
  }

  isLowConfidence(threshold = 30): boolean {
    return this.value < threshold;
  }

  compare(other: ConfidenceScore): number {
    return this.value - other.value;
  }

  equals(other: ConfidenceScore): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return `${this.value}%`;
  }
}
