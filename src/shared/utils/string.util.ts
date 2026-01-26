/**
 * Dice 계수를 사용한 문자열 유사도 유틸리티
 */

/**
 * 두 문자열 간의 유사도 계산 (0-1)
 */
export function compareTwoStrings(first: string, second: string): number {
  first = first.replace(/\s+/g, '').toLowerCase();
  second = second.replace(/\s+/g, '').toLowerCase();

  if (first === second) return 1;
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
