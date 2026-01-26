import { ContentMatchResult } from '@/application/ports';

/**
 * 통합 분석 프롬프트
 * 한 번의 AI 호출로 제목 추출 + TMDB 선택 + 결말 판단 수행
 */
export function buildUnifiedAnalysisPrompt(
  content: string,
  tmdbCandidates: ContentMatchResult[],
  runtimeSeconds?: number,
): string {
  const runtimeInfo = runtimeSeconds
    ? `\n영상 재생 시간: ${runtimeSeconds}초 (${Math.round(runtimeSeconds / 60)}분)`
    : '';

  const hasCandidates = tmdbCandidates.length > 0;

  const candidatesInfo = hasCandidates
    ? tmdbCandidates
        .map((candidate, index) => {
          const data = candidate.data;
          const title = candidate.type === 'movie' ? data.title : data.name;
          const originalTitle =
            candidate.type === 'movie' ? data.originalTitle : data.originalName;
          const releaseDate =
            candidate.type === 'movie' ? data.releaseDate : data.firstAirDate;
          const year = releaseDate ? new Date(releaseDate).getFullYear() : 'N/A';

          return `${index + 1}. [${candidate.type.toUpperCase()}] ${title}
   원제: ${originalTitle}
   개봉연도: ${year}
   개요: ${(data.overview || '').substring(0, 100)}...
   인기도: ${data.popularity || 0}
   TMDB ID: ${data.id}`;
        })
        .join('\n\n')
    : '(후보 없음 - 제목 추출 필요)';

  return `당신은 YouTube 영화/드라마 리뷰 영상 분석 전문가입니다.${runtimeInfo}

=== 분석 대상 ===
${content}

=== TMDB 후보 목록 ===
${candidatesInfo}

=== 분석 작업 ===
1. **제목 추출**: 영상에서 언급되는 영화/드라마 제목을 추출 (한국어, 영어 모두)
2. **결말 포함 여부**: 이 영상이 스포일러나 결말을 포함하는지 판단
${hasCandidates ? '3. **TMDB 선택**: 위 후보 중 가장 적합한 작품 선택' : ''}

=== 분석 방법 ===
- 자막에서 "오늘 소개할 영화는 XXX", "XXX라는 영화" 등의 패턴을 찾으세요
- 영상 설명과 제목도 함께 분석하세요
- 결말 키워드: 결말, 엔딩, 스포일러, 반전, 최종화 등

=== 응답 형식 (JSON만) ===
{
  "extracted_titles": ["추출된 제목들"],
  "includes_ending": true/false,
  "confidence": 0-100,
  "reasoning": "분석 근거"${hasCandidates ? `,
  "selected_tmdb": {
    "index": 1,
    "tmdb_id": 12345,
    "type": "movie 또는 tv",
    "confidence": 0-100,
    "reasoning": "선택 이유"
  }` : ''}
}`;
}
