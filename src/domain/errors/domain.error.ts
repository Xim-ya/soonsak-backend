/**
 * 기본 도메인 에러
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 엔티티를 찾을 수 없음
 */
export class EntityNotFoundError extends DomainError {
  constructor(entityName: string, id: string | number) {
    super(`${entityName} not found: ${id}`);
    this.name = 'EntityNotFoundError';
  }
}

/**
 * 유효하지 않은 값
 */
export class InvalidValueError extends DomainError {
  constructor(valueName: string, value: unknown, reason?: string) {
    const message = reason
      ? `Invalid ${valueName}: ${value}. ${reason}`
      : `Invalid ${valueName}: ${value}`;
    super(message);
    this.name = 'InvalidValueError';
  }
}

/**
 * 비즈니스 규칙 위반
 */
export class BusinessRuleViolationError extends DomainError {
  constructor(rule: string) {
    super(`Business rule violation: ${rule}`);
    this.name = 'BusinessRuleViolationError';
  }
}

/**
 * TMDB 매칭 실패
 */
export class TMDBMatchNotFoundError extends DomainError {
  constructor(searchTerms: string[]) {
    super(`No TMDB match found for: ${searchTerms.join(', ')}`);
    this.name = 'TMDBMatchNotFoundError';
  }
}

/**
 * AI 분석 실패
 */
export class AIAnalysisError extends DomainError {
  constructor(reason: string) {
    super(`AI analysis failed: ${reason}`);
    this.name = 'AIAnalysisError';
  }
}
