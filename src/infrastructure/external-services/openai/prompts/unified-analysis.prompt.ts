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
1. **제목 추출**: 이 영상이 리뷰하는 실제 영화/드라마의 **공식 제목**을 추출
2. **결말 포함 여부**: 이 영상이 스포일러나 결말을 포함하는지 판단
${hasCandidates ? '3. **TMDB 선택**: 위 후보 중 이 영상이 실제로 리뷰하는 작품을 선택. 일치하는 후보가 없으면 selected_tmdb를 null로 설정하세요. confidence가 50 미만이면 선택하지 마세요.' : ''}

=== 제목 추출 방법 ===
이 영상은 영화/드라마 리뷰 채널의 콘텐츠입니다. 리뷰 대상 작품의 **실제 공식 제목**을 찾아야 합니다.
두 가지 방법으로 제목을 추출하세요. 결과를 **별도 필드**에 분리하여 반환합니다.

**1단계: 직접 언급 추출 → extracted_titles**
자막이나 영상 제목/설명에서 작품 제목이 직접 언급된 경우:
- "오늘 소개할 영화는 XXX", "이 영화는 XXX", "XXX라는 영화/드라마"
- "오늘의 영화 XXX", "XXX를 리뷰", "XXX 리뷰입니다"
- "넷플릭스 영화 XXX", "XXX라는 작품"
- 영상 제목/설명에 작품명이 명시된 경우
→ 찾은 제목을 extracted_titles에 넣으세요. 없으면 빈 배열 [].

**2단계: 줄거리 기반 추론 → inferred_titles**
1단계에서 제목을 찾지 못한 경우에만 시도하세요:
- 자막에 묘사된 스토리 전개, 캐릭터 관계, 배경 설정을 종합하세요
- 언급되는 배우, 감독, 플랫폼(넷플릭스 등), 개봉연도 등의 단서를 활용하세요
- 당신이 알고 있는 영화/드라마 지식을 활용하여 해당 줄거리와 일치하는 작품을 특정하세요
- 추론한 제목은 반드시 실제 존재하는 영화/드라마의 공식 제목이어야 합니다
→ 추론한 제목을 inferred_titles에 넣으세요. 자신이 없으면 빈 배열 [].

**주의사항:**
- 등장인물 이름, 작중 소품/장소/일기 이름은 제목이 아닙니다
- "수작", "명작", "갓작" 등 평가 수식어는 제목이 아닙니다
- 존재하지 않는 제목을 만들어내지 마세요
- **반드시 한국어 제목과 영어(또는 원어) 제목을 모두 포함하세요** (TMDB 검색 정확도 향상에 필수)
- 한국어 제목과 원제는 **배열의 별도 요소**로 넣으세요
  예: ["교실 안의 야크", "Yak in the Classroom"] (O)
  예: ["교실 안의 야크 (Yak in the Classroom)"] (X - 하나로 합치지 마세요)
  예: ["교실 안의 야크"] (X - 영어 제목 누락)

=== 결말 판단 ===
- 결말 키워드: 결말, 엔딩, 스포일러, 반전, 최종화 등
${hasCandidates ? '\n=== TMDB 선택 ===\n- 영상 내용과 확실히 일치하는 작품만 선택하세요\n- 후보 중 리뷰 대상 작품이 없다면 반드시 null을 반환하세요' : ''}

=== 응답 형식 (JSON만) ===
{
  "extracted_titles": ["직접 언급된 제목들 (없으면 빈 배열)"],
  "inferred_titles": ["줄거리 추론 제목들 (없으면 빈 배열)"],
  "includes_ending": true/false,
  "confidence": 0-100,
  "reasoning": "분석 근거"${hasCandidates ? `,
  "selected_tmdb": null 또는 {
    "index": 1,
    "tmdb_id": 12345,
    "type": "movie 또는 tv",
    "confidence": 0-100,
    "reasoning": "선택 이유"
  }` : ''}
}`;
}
