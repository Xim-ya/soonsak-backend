import { Injectable } from '@nestjs/common';

/**
 * 결말 감지 서비스
 * 비디오 제목과 설명에서 결말 포함 여부를 감지하는 로직
 */
@Injectable()
export class EndingDetectionService {
  private readonly explicitKeywords = [
    '결말포함',
    '결말',
    '엔딩',
    '스포일러',
    '스포',
    '최종화',
    '마지막화',
    '완결',
  ];

  private readonly seriesPatterns = [
    /시즌\s*\d+[\s\S]*시즌\s*\d+/,
    /시즌\s*1[\s\S]*뉴\s*블러드/,
    /전편/,
    /총집편/,
    // "몰아보기"는 결말포함 지표가 아님 - AI 판단에 위임
    /전체\s*정리/,
    /완전\s*정리/,
    /처음부터\s*끝까지/,
  ];

  /**
   * 제목과 설명에서 결말 포함 여부 감지
   */
  detectFromContent(title: string, description?: string): boolean {
    const text = `${title} ${description || ''}`.toLowerCase();

    if (this.hasExplicitKeyword(text)) {
      return true;
    }

    if (this.matchesSeriesPattern(text)) {
      return true;
    }

    if (this.hasMultipleSeasons(text)) {
      return true;
    }

    return false;
  }

  /**
   * 명시적 결말 키워드 존재 여부
   */
  private hasExplicitKeyword(text: string): boolean {
    return this.explicitKeywords.some((keyword) => text.includes(keyword));
  }

  /**
   * 시리즈 전체 패턴 매칭
   */
  private matchesSeriesPattern(text: string): boolean {
    return this.seriesPatterns.some((pattern) => pattern.test(text));
  }

  /**
   * 다중 시즌 언급 확인 (3개 이상)
   */
  private hasMultipleSeasons(text: string): boolean {
    const seasonMatches = text.match(/시즌\s*\d+/g);
    return Boolean(seasonMatches && seasonMatches.length >= 3);
  }
}
