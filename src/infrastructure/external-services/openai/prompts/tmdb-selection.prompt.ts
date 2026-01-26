import { ContentMatchResult } from '@/application/ports';

/**
 * TMDB 선택 프롬프트
 * TMDB 후보가 있을 때 최적 매치 선택용
 */
export function buildTMDBSelectionPrompt(
  content: string,
  tmdbCandidates: ContentMatchResult[],
  runtimeSeconds?: number,
): string {
  const runtimeInfo = runtimeSeconds
    ? `\n영상 재생 시간: ${runtimeSeconds}초 (${Math.round(runtimeSeconds / 60)}분)`
    : '';

  const candidatesInfo = tmdbCandidates
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
   TMDB ID: ${data.id}`;
    })
    .join('\n\n');

  return `다음 YouTube 동영상의 제목, 설명, 자막을 종합 분석해주세요:${runtimeInfo}

분석 대상 콘텐츠:
${content}

TMDB 검색 후보들:
${candidatesInfo}

요청사항:
1. 이 동영상에서 다루는 영화나 TV 프로그램의 정확한 제목을 추출해주세요 (한국어, 영어 모두)
2. 이 동영상이 해당 작품의 결말이나 스포일러를 포함하는지 판단해주세요
3. 위의 TMDB 후보들 중 가장 적합한 작품을 선택해주세요

다음 JSON 형식으로 응답해주세요:
{
  "extracted_titles": ["제목1", "제목2"],
  "includes_ending": true/false,
  "confidence": 85,
  "reasoning": "분석 근거 설명",
  "selected_tmdb": {
    "index": 1,
    "tmdb_id": 12345,
    "type": "movie",
    "confidence": 90,
    "reasoning": "선택한 이유"
  },
  "story_analysis": {
    "has_beginning": true/false,
    "has_middle": true/false,
    "has_ending": true/false,
    "story_completeness": "complete/partial/review_only"
  }
}`;
}
