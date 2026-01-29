import { ContentMetadataForSection } from '@/application/ports';

/**
 * TMDB 장르 ID -> 한국어 매핑
 */
const TMDB_GENRE_MAP: Record<number, string> = {
  28: '액션',
  12: '모험',
  16: '애니메이션',
  35: '코미디',
  80: '범죄',
  99: '다큐멘터리',
  18: '드라마',
  10751: '가족',
  14: '판타지',
  36: '역사',
  27: '공포',
  10402: '음악',
  9648: '미스터리',
  10749: '로맨스',
  878: 'SF',
  10770: 'TV 영화',
  53: '스릴러',
  10752: '전쟁',
  37: '서부',
  // TV 전용 장르
  10759: '액션 & 어드벤처',
  10762: '키즈',
  10763: '뉴스',
  10764: '리얼리티',
  10765: 'SF & 판타지',
  10766: '연속극',
  10767: '토크',
  10768: '전쟁 & 정치',
};

/**
 * 장르 ID를 한국어 이름으로 변환
 */
function getGenreNames(genreIds?: number[]): string[] {
  if (!genreIds) return [];
  return genreIds
    .map((id) => TMDB_GENRE_MAP[id])
    .filter((name): name is string => !!name);
}

/**
 * 콘텐츠 메타데이터를 AI 프롬프트용 텍스트로 변환
 */
function formatContentForPrompt(content: ContentMetadataForSection): string {
  const genres = getGenreNames(content.genreIds).join(', ');
  const year = content.releaseDate
    ? new Date(content.releaseDate).getFullYear()
    : 'N/A';
  const type = content.contentType === 'movie' ? '영화' : 'TV';

  return `[ID:${content.id}] ${content.title} (${type}, ${year})
  장르: ${genres || '미분류'}
  태그라인: ${content.tagline || '없음'}
  줄거리: ${(content.overview || '').substring(0, 150)}...`;
}

/**
 * 홈 섹션 생성 프롬프트
 */
export function buildHomeSectionGenerationPrompt(
  contents: ContentMetadataForSection[],
  sectionCount: number = 5,
  itemsPerSection: number = 10,
): string {
  const contentList = contents
    .map((c) => formatContentForPrompt(c))
    .join('\n\n');

  return `당신은 OTT 플랫폼의 큐레이터입니다. 주어진 콘텐츠 목록을 분석하여 메인 홈 화면에 표시할 테마별 섹션을 생성해주세요.

=== 콘텐츠 목록 (총 ${contents.length}개) ===
${contentList}

=== 요청 사항 ===
위 콘텐츠들을 분석하여 ${sectionCount}개의 테마별 섹션을 만들어주세요.

**섹션 제목 예시:**
- "기울어진 우정, 엇갈린 청춘" (우정/배신/성장 테마)
- "시간아, 멈춰" (시간 여행 테마)
- "박찬욱, 완벽한 미장센" (감독 특집)
- "밤새 몰아보기 각" (긴 시리즈물)
- "웃다가 눈물" (코미디+드라마)

**규칙:**
1. 각 섹션에 ${itemsPerSection}개 내외의 콘텐츠 포함
2. 섹션 제목은 감각적이고 창의적으로 (단순 장르명 X)
3. 콘텐츠 중복 허용 (여러 테마에 해당할 수 있음)
4. 테마 키워드 2-4개 포함
5. 한국어로 작성

=== 응답 형식 (JSON만) ===
{
  "sections": [
    {
      "title": "섹션 제목",
      "subtitle": "부제목 (선택, 10자 이내)",
      "theme_keywords": ["키워드1", "키워드2"],
      "content_ids": [
        {"id": 123, "type": "movie"},
        {"id": 456, "type": "tv"}
      ],
      "reasoning": "이 섹션을 만든 이유 (30자 이내)"
    }
  ]
}

JSON 형식으로만 응답하세요.`;
}

/**
 * 규칙 기반 폴백 섹션 생성 (AI 실패 시)
 */
export function generateFallbackSections(
  contents: ContentMetadataForSection[],
): {
  title: string;
  subtitle?: string;
  themeKeywords: string[];
  contentIds: Array<{ contentId: number; contentType: 'movie' | 'tv' }>;
  reasoning: string;
}[] {
  const sections: {
    title: string;
    subtitle?: string;
    themeKeywords: string[];
    contentIds: Array<{ contentId: number; contentType: 'movie' | 'tv' }>;
    reasoning: string;
  }[] = [];

  // 1. 장르별 섹션
  const genreGroups: Record<string, ContentMetadataForSection[]> = {};
  for (const content of contents) {
    const genreNames = getGenreNames(content.genreIds);
    for (const genre of genreNames) {
      if (!genreGroups[genre]) {
        genreGroups[genre] = [];
      }
      genreGroups[genre].push(content);
    }
  }

  // 가장 많은 콘텐츠를 가진 장르 상위 3개
  const topGenres = Object.entries(genreGroups)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3);

  const genreTitles: Record<string, string> = {
    액션: '아드레날린 폭발',
    드라마: '감정의 롤러코스터',
    코미디: '웃음 충전소',
    스릴러: '심장이 쫄깃',
    로맨스: '설렘 가득',
    SF: '미래가 궁금해',
    판타지: '상상 그 이상',
    공포: '오싹한 밤',
    범죄: '범인을 찾아라',
  };

  for (const [genre, genreContents] of topGenres) {
    if (genreContents.length >= 4) {
      sections.push({
        title: genreTitles[genre] || `${genre} 특선`,
        themeKeywords: [genre],
        contentIds: genreContents.slice(0, 10).map((c) => ({
          contentId: c.id,
          contentType: c.contentType,
        })),
        reasoning: `${genre} 장르 콘텐츠 모음`,
      });
    }
  }

  // 2. 타입별 섹션 (영화 vs TV)
  const movies = contents.filter((c) => c.contentType === 'movie');
  const tvShows = contents.filter((c) => c.contentType === 'tv');

  if (movies.length >= 4) {
    sections.push({
      title: '영화관 온 기분',
      subtitle: '2시간의 여정',
      themeKeywords: ['영화', '극장'],
      contentIds: movies.slice(0, 10).map((c) => ({
        contentId: c.id,
        contentType: c.contentType,
      })),
      reasoning: '영화 콘텐츠 모음',
    });
  }

  if (tvShows.length >= 4) {
    sections.push({
      title: '밤새 정주행 각',
      subtitle: '멈출 수 없어',
      themeKeywords: ['드라마', '시리즈'],
      contentIds: tvShows.slice(0, 10).map((c) => ({
        contentId: c.id,
        contentType: c.contentType,
      })),
      reasoning: 'TV 시리즈 콘텐츠 모음',
    });
  }

  // 3. 전체 콘텐츠 섹션 (필러)
  if (sections.length < 3) {
    const shuffled = [...contents].sort(() => Math.random() - 0.5);
    sections.push({
      title: '오늘 뭐 볼까?',
      subtitle: '추천 콘텐츠',
      themeKeywords: ['추천', '인기'],
      contentIds: shuffled.slice(0, 10).map((c) => ({
        contentId: c.id,
        contentType: c.contentType,
      })),
      reasoning: '전체 콘텐츠에서 랜덤 선택',
    });
  }

  return sections;
}
