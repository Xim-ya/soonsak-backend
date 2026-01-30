import { Injectable } from '@nestjs/common';

/**
 * 제목 추출 서비스
 * YouTube 제목과 설명에서 영화/TV 제목 후보를 추출하는 12개 패턴 매칭 로직
 */
@Injectable()
export class TitleExtractionService {
  private readonly excludeKeywords = [
    // 장르/카테고리
    '영화리뷰',
    '결말포함',
    '결말',
    '리뷰',
    '넷플릭스',
    '영화추천',
    '드라마',
    '영화',
    '한국영화',
    '한국드라마',
    '코미디영화',
    '액션영화',
    '공포영화',
    '스릴러영화',
    '로맨스영화',
    '범죄영화',
    '일본영화',
    '중국영화',
    '미국영화',
    '외국영화',
    '한국명작',
    '명작영화',
    '신작영화',
    // 수식어/포맷 키워드
    '명작',
    '수작',
    '몰아보기',
    '드라마몰아보기',
    '폭풍감동',
    // 플랫폼
    '애플tv',
    '애플TV',
  ];

  /** 일반적인 장르/카테고리 접미사 — 이 접미사로 끝나는 짧은 후보는 제외 */
  private readonly genericSuffixes = ['영화', '드라마', '시리즈', '리뷰', '추천'];

  /**
   * YouTube 제목과 설명에서 영화/TV 제목 후보 추출
   */
  extractCandidates(youtubeTitle: string, description?: string): string[] {
    const candidates: string[] = [];

    this.extractFromTitle(youtubeTitle, candidates);

    if (description) {
      this.extractFromDescription(description, candidates);
    }

    this.extractHashtags(youtubeTitle, description, candidates);

    return [...new Set(candidates)].filter(
      (c) => c.length >= 2 && !this.isGenericTerm(c),
    );
  }

  /**
   * 일반적인 장르/카테고리 용어인지 판별
   * "한국영화", "코미디영화" 등 TMDB 검색에 불필요한 일반 키워드 제외
   */
  private isGenericTerm(text: string): boolean {
    const lower = text.toLowerCase().trim();
    if (this.excludeKeywords.includes(lower)) return true;
    return this.genericSuffixes.some(
      (suffix) => lower.endsWith(suffix) && lower.length <= suffix.length + 4,
    );
  }

  private extractFromTitle(title: string, candidates: string[]): void {
    // 패턴 1: "제목 | 기타정보"
    const pipeMatch = title.match(/^([^|]+)\s*\|/);
    if (pipeMatch?.[1]?.trim()) {
      candidates.push(pipeMatch[1].trim());
    }

    // 패턴 2: "[카테고리] 제목"
    const bracketMatch = title.match(/\[.*?\]\s*(.+)/);
    if (bracketMatch?.[1]?.trim()) {
      candidates.push(bracketMatch[1].trim());
    }

    // 패턴 3: "제목 - 기타정보"
    const dashMatch = title.match(/^([^-]+)\s*-/);
    if (dashMatch?.[1]?.trim() && dashMatch[1].trim().length > 2) {
      candidates.push(dashMatch[1].trim());
    }

    // 패턴 4: "제목 (연도)"
    const parenMatch = title.match(/^(.+?)\s*\(/);
    if (parenMatch?.[1]?.trim()) {
      candidates.push(parenMatch[1].trim());
    }

    // 패턴 6: 인용 텍스트
    const quotedMatches = title.match(/"([^"]{2,20})"/g);
    if (quotedMatches) {
      quotedMatches.forEach((q) => {
        const cleaned = q.replace(/"/g, '').trim();
        if (!candidates.includes(cleaned)) {
          candidates.push(cleaned);
        }
      });
    }
  }

  private extractFromDescription(description: string, candidates: string[]): void {
    // 패턴 7: 설명의 첫 줄
    this.extractFromFirstLine(description, candidates);

    // 패턴 8: 특수 인용 부호
    this.extractSpecialQuotes(description, candidates);

    // 패턴 9: 설명 내 인용 텍스트
    this.extractQuotedText(description, candidates);

    // 패턴 10: 원제 패턴
    this.extractOriginalTitle(description, candidates);

    // 패턴 10-2: 연도가 포함된 인라인 제목
    this.extractInlineTitles(description, candidates);

    // 패턴 10-1: 라벨이 붙은 제목
    this.extractLabeledTitles(description, candidates);

    // 패턴 11, 12: 별도 줄의 제목
    this.extractFromLines(description, candidates);
  }

  private extractFromFirstLine(description: string, candidates: string[]): void {
    const firstLine = description.split('\n')[0]?.trim();
    if (!firstLine || firstLine.length < 2 || firstLine.length > 50) {
      return;
    }

    if (/^\d/.test(firstLine) || !/[가-힣a-zA-Z]/.test(firstLine)) {
      return;
    }

    const cleanedFirstLine = firstLine
      .replace(/^(영화|제목|작품|Movie|Title)\s*[:：]\s*/i, '')
      .trim();

    const bilingualMatch = cleanedFirstLine.match(
      /^([가-힣\s]+)\s*\(([a-zA-Z\s:'\-]+),?\s*\d{4}\)$/,
    );

    if (bilingualMatch) {
      const koreanTitle = bilingualMatch[1].trim();
      const englishTitle = bilingualMatch[2].trim();
      if (koreanTitle.length >= 2 && !candidates.includes(koreanTitle)) {
        candidates.push(koreanTitle);
      }
      if (englishTitle.length >= 2 && !candidates.includes(englishTitle)) {
        candidates.push(englishTitle);
      }
    } else if (
      cleanedFirstLine.length >= 2 &&
      cleanedFirstLine.length <= 30 &&
      !candidates.includes(cleanedFirstLine)
    ) {
      candidates.push(cleanedFirstLine);
    }
  }

  private extractSpecialQuotes(description: string, candidates: string[]): void {
    const specialQuotes = description.match(/[「『<《]([^」』>》]{2,20})[」』>》]/g);
    if (specialQuotes) {
      specialQuotes.forEach((q) => {
        const cleaned = q.replace(/[「」『』<>《》]/g, '').trim();
        if (cleaned.length >= 2 && !candidates.includes(cleaned)) {
          candidates.push(cleaned);
        }
      });
    }
  }

  private extractQuotedText(description: string, candidates: string[]): void {
    const descQuoted = description.match(/["']([^"']{2,20})["']/g);
    if (descQuoted) {
      descQuoted.forEach((q) => {
        const cleaned = q.replace(/["']/g, '').trim();
        if (cleaned.length >= 2 && !candidates.includes(cleaned)) {
          candidates.push(cleaned);
        }
      });
    }
  }

  private extractOriginalTitle(description: string, candidates: string[]): void {
    const originalTitle = description.match(/원제[목]?\s*[:：]\s*([^\n,]{2,30})/);
    if (originalTitle?.[1]?.trim()) {
      const cleaned = originalTitle[1].trim();
      if (!candidates.includes(cleaned)) {
        candidates.push(cleaned);
      }
    }
  }

  private extractInlineTitles(description: string, candidates: string[]): void {
    const inlineTitleMatches = description.match(
      /(?:^|[\s,."'·:])([가-힣a-zA-Z][가-힣a-zA-Z0-9]{0,15})\s*\((\d{4})\)/g,
    );
    if (inlineTitleMatches) {
      inlineTitleMatches.forEach((match) => {
        const titleMatch = match.match(
          /([가-힣a-zA-Z][가-힣a-zA-Z0-9]{0,15})\s*\(\d{4}\)/,
        );
        if (titleMatch?.[1]) {
          const title = titleMatch[1].trim();
          if (title.length >= 2 && title.length <= 15 && !candidates.includes(title)) {
            candidates.push(title);
          }
        }
      });
    }
  }

  private extractLabeledTitles(description: string, candidates: string[]): void {
    const labeledTitle = description.match(
      /(?:영상[-\s]*)?(?:영화|드라마|작품|시리즈)\s*[:：]\s*([^\n]{2,30})/,
    );
    if (labeledTitle?.[1]?.trim()) {
      const cleaned = labeledTitle[1].trim();
      if (!candidates.includes(cleaned)) {
        candidates.push(cleaned);
      }
    }
  }

  private extractFromLines(description: string, candidates: string[]): void {
    const lines = description.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      // 패턴 11: 별도 줄의 연도가 포함된 제목
      const movieTitleMatch = trimmed.match(
        /^([가-힣a-zA-Z0-9\s:·\-]+)\s*\(?(\d{4})\)?$/,
      );
      if (movieTitleMatch?.[1]) {
        const title = movieTitleMatch[1].trim();
        if (title.length >= 2 && title.length <= 25 && !candidates.includes(title)) {
          candidates.push(title);
        }
      }

      // 패턴 12: 이모지 + 제목
      const strippedLine = trimmed.replace(
        /^[\u{1F3AC}\u{1F3A5}\u{1F39E}\u{1F4FD}\u{1F3A6}]\s*/u,
        '',
      );
      if (strippedLine !== trimmed) {
        const titleMatch = strippedLine.match(/^([가-힣a-zA-Z0-9\s:·\-]+)\s*\(/);
        if (titleMatch?.[1]) {
          const title = titleMatch[1].trim();
          if (title.length >= 2 && title.length <= 25 && !candidates.includes(title)) {
            candidates.push(title);
          }
        }
      }
    }
  }

  private extractHashtags(
    title: string,
    description: string | undefined,
    candidates: string[],
  ): void {
    const allText = title + ' ' + (description || '');
    const hashtags = allText.match(/#([가-힣a-zA-Z0-9]+)/g);
    if (hashtags) {
      hashtags.forEach((tag) => {
        const cleaned = tag.replace('#', '').trim();
        if (
          cleaned.length >= 2 &&
          cleaned.length <= 20 &&
          !this.isGenericTerm(cleaned) &&
          !candidates.includes(cleaned)
        ) {
          candidates.push(cleaned);
        }
      });
    }
  }
}
