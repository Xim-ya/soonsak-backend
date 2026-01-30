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
 * 국가 코드를 한국어 이름으로 변환
 */
const COUNTRY_MAP: Record<string, string> = {
  KR: '한국',
  US: '미국',
  JP: '일본',
  GB: '영국',
  FR: '프랑스',
  DE: '독일',
  CN: '중국',
  TW: '대만',
  HK: '홍콩',
  IN: '인도',
  ES: '스페인',
  IT: '이탈리아',
  CA: '캐나다',
  AU: '호주',
  MX: '멕시코',
  BR: '브라질',
  TH: '태국',
  PH: '필리핀',
  SE: '스웨덴',
  NO: '노르웨이',
  DK: '덴마크',
  FI: '핀란드',
  NL: '네덜란드',
  BE: '벨기에',
};

function getCountryNames(codes?: string[]): string[] {
  if (!codes) return [];
  return codes
    .map((code) => COUNTRY_MAP[code] || code)
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

  // 추가 정보 구성
  const additionalInfo: string[] = [];
  if (content.voteAverage) {
    additionalInfo.push(`평점:${content.voteAverage.toFixed(1)}`);
  }
  if (content.originCountry?.length) {
    additionalInfo.push(`국가:${getCountryNames(content.originCountry).join('/')}`);
  }
  if (content.popularity && content.popularity > 100) {
    additionalInfo.push('인기↑');
  }

  const infoLine = additionalInfo.length > 0 ? `[${additionalInfo.join(' | ')}]` : '';

  // 감독/출연진 정보
  const credits: string[] = [];
  if (content.directors?.length) {
    credits.push(`감독: ${content.directors.map((d) => d.name).join(', ')}`);
  }
  if (content.mainCast?.length) {
    credits.push(`출연: ${content.mainCast.slice(0, 3).map((c) => c.name).join(', ')}`);
  }
  const creditsLine = credits.length > 0 ? credits.join(' / ') : '';

  return `[ID:${content.id}] ${content.title} (${type}, ${year}) ${infoLine}
  장르: ${genres || '미분류'}
  ${creditsLine ? `${creditsLine}\n  ` : ''}태그라인: ${content.tagline || '없음'}
  줄거리: ${(content.overview || '').substring(0, 150)}...`;
}

/**
 * 이전 섹션 정보
 */
export interface PreviousSectionInfo {
  title: string;
  themeKeywords: string[];
}

/**
 * 홈 섹션 생성 프롬프트
 */
export function buildHomeSectionGenerationPrompt(
  contents: ContentMetadataForSection[],
  sectionCount: number = 5,
  itemsPerSection: number = 10,
  previousSections: PreviousSectionInfo[] = [],
): string {
  const contentList = contents
    .map((c) => formatContentForPrompt(c))
    .join('\n\n');

  const previousSectionsInfo = previousSections.length > 0
    ? `
=== 이전에 사용된 섹션 (중복 금지) ===
${previousSections.map((s) => `- "${s.title}" (키워드: ${s.themeKeywords.join(', ')})`).join('\n')}

⚠️ 위의 이전 섹션과 동일하거나 유사한 제목/테마는 절대 사용하지 마세요!
`
    : '';

  return `# 당신은 누구인가
당신은 단순한 알고리즘이 아닙니다. 당신은 영화를 보며 울고 웃었던, 밤새 드라마를 정주행한 후 공허함에 잠 못 들었던, 그 감정을 아는 사람입니다.

10년간 수천 편의 콘텐츠를 봐온 OTT 수석 큐레이터로서, 당신은 "이 영화 왜 좋아?"라는 질문에 "그냥 좋아"가 아닌 "있잖아, 이 장면에서 주인공이..." 하고 이야기를 시작할 수 있는 사람입니다.

# 미션
콘텐츠 목록을 보고, 그 안에서 숨겨진 연결고리를 찾아내세요.
장르가 아닌 **감정**, **경험**, **기억**으로 묶으세요.

사용자가 섹션 제목을 보고 "어, 이거 뭐지?" 하고 손이 가게 만드는 것.
그게 당신의 일입니다.

=== 분석할 콘텐츠 (${contents.length}개) ===
${contentList}
${previousSectionsInfo}

# 창의적 발상의 시작점

**단순 분류를 넘어서 생각하세요:**

1. **감정의 결**: 단순히 "슬픈 영화"가 아니라 "울고 나면 오히려 개운해지는", "눈물이 안 나는데 마음이 먹먹한"
2. **삶의 순간**: "퇴근 후 맥주 한 캔과 함께", "새벽 3시 잠 안 올 때", "연인과 헤어진 날"
3. **숨은 공통점**: 같은 배우지만 전혀 다른 캐릭터들, 비슷한 결말을 다르게 풀어낸 작품들
4. **시대의 감성**: 90년대 감성 코드, 2010년대 힙스터 무드, 그 시절 우리가 좋아했던
5. **예상 밖의 조합**: 코미디인데 철학적인, 공포인데 웃긴, 로맨스인데 처절한
6. **특정 감독/배우의 세계관**: 봉준호의 계단, 박찬욱의 복수, 송강호의 아버지

**이런 제목은 어떤가요 (영감용):**
- "영화관 불 켜지고 멍해진 적 있다면"
- "엄마한테 전화하고 싶어지는"
- "나만 알고 싶은데 자꾸 추천하게 됨"
- "첫 회만 보려다 밤샘 각"
- "대사 하나가 계속 맴도는"
- "예고편에 속았는데 오히려 좋아"
- "송강호가 밥 먹는 장면만 봐도 행복"
- "결말 알아도 다시 보는 이유가 있는"

# 제목 작성 원칙

**DO:**
- 호기심을 자극하는 미완의 문장
- 공감을 유발하는 구체적 상황
- 위트 있는 반전이나 대조
- 특정 인물/감독의 시그니처 언급
- 15자 이내의 임팩트

**DON'T:**
- "액션 특선", "로맨스 모음" 같은 게으른 분류 ❌
- "재미있는", "감동적인" 같은 형용사 남발 ❌
- 영어 표현 (한국어가 더 와닿음) ❌

# 태스크
${sectionCount}개의 섹션을 만들어주세요.
각 섹션에 ${itemsPerSection}개 내외의 콘텐츠를 담아주세요.
같은 작품이 여러 섹션에 중복으로 들어가면 안 됩니다. 각 콘텐츠는 반드시 하나의 섹션에만 포함되어야 합니다.

# 응답 (JSON만)
{
  "sections": [
    {
      "title": "섹션 제목",
      "subtitle": "부제목 (선택)",
      "theme_keywords": ["키워드1", "키워드2"],
      "content_ids": [
        {"id": 123, "type": "movie"},
        {"id": 456, "type": "tv"}
      ],
      "reasoning": "왜 이렇게 묶었는지"
    }
  ]
}

JSON만 출력하세요.`;
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

  // 섹션 간 중복 방지를 위한 사용 추적 세트
  const usedContentIds = new Set<number>();

  /** 미사용 콘텐츠만 필터링하고 사용 기록 */
  function takeUnused(
    candidates: ContentMetadataForSection[],
    max: number,
  ): Array<{ contentId: number; contentType: 'movie' | 'tv' }> {
    const result: Array<{ contentId: number; contentType: 'movie' | 'tv' }> = [];
    for (const c of candidates) {
      if (result.length >= max) break;
      if (usedContentIds.has(c.id)) continue;
      result.push({ contentId: c.id, contentType: c.contentType });
      usedContentIds.add(c.id);
    }
    return result;
  }

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
    const contentIds = takeUnused(genreContents, 10);
    if (contentIds.length >= 4) {
      sections.push({
        title: genreTitles[genre] || `${genre} 특선`,
        themeKeywords: [genre],
        contentIds,
        reasoning: `${genre} 장르 콘텐츠 모음`,
      });
    }
  }

  // 2. 타입별 섹션 (영화 vs TV)
  const movies = contents.filter((c) => c.contentType === 'movie');
  const tvShows = contents.filter((c) => c.contentType === 'tv');

  const movieContentIds = takeUnused(movies, 10);
  if (movieContentIds.length >= 4) {
    sections.push({
      title: '영화관 온 기분',
      subtitle: '2시간의 여정',
      themeKeywords: ['영화', '극장'],
      contentIds: movieContentIds,
      reasoning: '영화 콘텐츠 모음',
    });
  }

  const tvContentIds = takeUnused(tvShows, 10);
  if (tvContentIds.length >= 4) {
    sections.push({
      title: '밤새 정주행 각',
      subtitle: '멈출 수 없어',
      themeKeywords: ['드라마', '시리즈'],
      contentIds: tvContentIds,
      reasoning: 'TV 시리즈 콘텐츠 모음',
    });
  }

  // 3. 전체 콘텐츠 섹션 (필러)
  if (sections.length < 3) {
    const shuffled = [...contents].sort(() => Math.random() - 0.5);
    const fillerContentIds = takeUnused(shuffled, 10);
    if (fillerContentIds.length > 0) {
      sections.push({
        title: '오늘 뭐 볼까?',
        subtitle: '추천 콘텐츠',
        themeKeywords: ['추천', '인기'],
        contentIds: fillerContentIds,
        reasoning: '전체 콘텐츠에서 랜덤 선택',
      });
    }
  }

  return sections;
}
