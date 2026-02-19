/**
 * 타이틀 로고 언어 enum
 * DB의 logo_language_enum과 1:1 대응
 */
export enum LogoLanguage {
  KO = 'ko',
  EN = 'en',
}

/**
 * 문자열을 LogoLanguage enum으로 변환
 * 유효하지 않은 값이면 기본값(EN) 반환
 */
export function toLogoLanguage(value: string | null | undefined): LogoLanguage | null {
  if (!value) return null;

  if (value === LogoLanguage.KO) return LogoLanguage.KO;
  if (value === LogoLanguage.EN) return LogoLanguage.EN;

  return LogoLanguage.EN; // 기본값
}
