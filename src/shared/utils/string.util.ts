/**
 * Dice 계수를 사용한 문자열 유사도 유틸리티
 */

/**
 * 한국어 발음 변형 정규화
 * 외래어 표기 차이를 통일 (예: 레퀴엠 ↔ 레키엠, 패러다이스 ↔ 파라다이스)
 */
export function normalizeKoreanPhonetics(text: string): string {
  return text
    // 자음 변형
    .replace(/퀴/g, '키')   // 레퀴엠 → 레키엠
    .replace(/뀌/g, '끼')
    .replace(/쉬/g, '시')   // 쉐 → 셰
    .replace(/쉐/g, '셰')
    .replace(/뷔/g, '비')   // 뷔페 → 비페
    // 모음 변형
    .replace(/애/g, '에')   // 매트릭스 → 메트릭스
    .replace(/얘/g, '예')
    .replace(/웨/g, '워')   // 웨스트 → 워스트
    .replace(/외/g, '워')
    // 복합 변형 (외래어 표기)
    .replace(/크로/g, '클로')   // 크로니클 → 클로니클
    .replace(/메트/g, '맷')     // 메트릭스 → 맷릭스
    .replace(/패러/g, '파라')   // 패러다이스 → 파라다이스
    .replace(/페러/g, '파라')
    .replace(/데이/g, '다이')   // 데이트 → 다이트
    // 받침 변형
    .replace(/릭스/g, '릭')     // 매트릭스 → 매트릭
    .replace(/스$/g, '')        // 끝 '스' 제거 (선택적)
    // 흔한 외래어 변형
    .replace(/아웃/g, '아웃')
    .replace(/인/g, '인')
    .trim();
}

/**
 * 두 문자열 간의 유사도 계산 (0-1)
 */
export function compareTwoStrings(first: string, second: string): number {
  first = first.replace(/\s+/g, '').toLowerCase();
  second = second.replace(/\s+/g, '').toLowerCase();

  if (first === second) return 1;

  // 한국어 발음 정규화 후 비교
  const normalizedFirst = normalizeKoreanPhonetics(first);
  const normalizedSecond = normalizeKoreanPhonetics(second);
  if (normalizedFirst === normalizedSecond) return 1;
  if (first.length < 2 || second.length < 2) return 0;

  const firstBigrams = new Map<string, number>();
  for (let i = 0; i < first.length - 1; i++) {
    const bigram = first.substring(i, i + 2);
    const count = firstBigrams.get(bigram) ?? 0;
    firstBigrams.set(bigram, count + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < second.length - 1; i++) {
    const bigram = second.substring(i, i + 2);
    const count = firstBigrams.get(bigram) ?? 0;

    if (count > 0) {
      firstBigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2.0 * intersectionSize) / (first.length + second.length - 2);
}

/**
 * 후보 목록에서 가장 일치하는 문자열 찾기
 */
export function findBestMatch(
  mainString: string,
  candidates: string[],
): { bestMatch: { target: string; rating: number }; bestMatchIndex: number } {
  if (candidates.length === 0) {
    throw new Error('Candidates array cannot be empty');
  }

  const ratings = candidates.map((target) => ({
    target,
    rating: compareTwoStrings(mainString, target),
  }));

  const bestMatchIndex = ratings.reduce(
    (bestIdx, curr, idx, arr) =>
      curr.rating > arr[bestIdx].rating ? idx : bestIdx,
    0,
  );

  return {
    bestMatch: ratings[bestMatchIndex],
    bestMatchIndex,
  };
}

/**
 * 한글 불용어 목록 (조사, 접속사, 일반적인 단어)
 */
const KOREAN_STOPWORDS = new Set([
  '이', '그', '저', '것', '수', '등', '들', '및', '를', '을', '에', '의', '가', '은', '는',
  '로', '으로', '와', '과', '도', '만', '에서', '까지', '부터', '처럼', '같이', '보다',
  '하다', '되다', '있다', '없다', '않다', '이다', '아니다', '하는', '되는', '있는', '없는',
  '그리고', '하지만', '그러나', '또는', '또한', '그래서', '때문에', '위해', '통해', '대해',
  '영화', '드라마', '시리즈', '이야기', '작품', '내용', '결말', '스토리', '리뷰',
  '오늘', '어느', '모든', '어떤', '매우', '정말', '너무', '아주', '더', '가장', '다시',
]);

/**
 * 텍스트에서 의미있는 키워드 추출 (2자 이상 명사/단어)
 */
export function extractKeywords(text: string): string[] {
  if (!text) return [];

  // 특수문자 제거, 공백으로 분리
  const words = text
    .replace(/[^\w\s가-힣]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .map((w) => w.toLowerCase());

  // 불용어 제거 및 중복 제거
  const keywords = words.filter((w) => !KOREAN_STOPWORDS.has(w));
  return [...new Set(keywords)];
}

/**
 * 두 텍스트 간의 키워드 기반 유사도 계산 (Jaccard 유사도)
 * @returns 0-1 사이의 유사도 점수
 */
export function compareByKeywords(text1: string, text2: string): number {
  const keywords1 = extractKeywords(text1);
  const keywords2 = extractKeywords(text2);

  if (keywords1.length === 0 || keywords2.length === 0) return 0;

  const set1 = new Set(keywords1);
  const set2 = new Set(keywords2);

  let intersection = 0;
  for (const word of set1) {
    if (set2.has(word)) {
      intersection++;
    }
  }

  // Jaccard 유사도: intersection / union
  const union = set1.size + set2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * 줄거리 비교용 가중치 키워드 매칭
 * 짧은 overview와 긴 transcript 비교에 최적화
 * @returns 0-1 사이의 유사도 점수
 */
export function comparePlotContent(
  transcript: string,
  tmdbOverview: string,
): number {
  if (!transcript || !tmdbOverview) return 0;

  const transcriptKeywords = extractKeywords(transcript);
  const overviewKeywords = extractKeywords(tmdbOverview);

  if (overviewKeywords.length === 0) return 0;

  // overview의 키워드가 transcript에 얼마나 포함되어 있는지 (recall 기반)
  const transcriptSet = new Set(transcriptKeywords);
  let matchCount = 0;

  for (const keyword of overviewKeywords) {
    if (transcriptSet.has(keyword)) {
      matchCount++;
    }
  }

  // overview 키워드 중 transcript에서 발견된 비율
  return matchCount / overviewKeywords.length;
}
