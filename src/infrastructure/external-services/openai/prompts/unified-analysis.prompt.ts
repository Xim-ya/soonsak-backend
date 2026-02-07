import { ContentMatchResult } from '@/application/ports';

/**
 * 통합 분석 프롬프트
 * 한 번의 AI 호출로 제목 추출 + TMDB 선택 + 결말 판단 수행
 *
 * 최적화 기법 적용:
 * - Chain-of-Thought (CoT): 단계별 분석 프로세스
 * - Few-shot Learning: 3개 예시로 클릭베이트 대응
 * - Negative Prompting: 하지 말아야 할 것 명시
 * - Confidence Calibration: 점수 가이드라인 제공
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

  // Few-shot 예시 (클릭베이트 대응 강화)
  const fewShotExamples = `
=== 분석 예시 ===

**예시 1: 클릭베이트 제목 + 직접 언급**
입력 자막: "진짜 각오하고 올립니다... 오늘 리뷰할 영화는 기생충입니다. 봉준호 감독의 2019년 작품으로..."
출력:
{
  "extracted_titles": ["기생충"],
  "inferred_titles": [],
  "english_titles": ["Parasite"],
  "inferred_year": 2019,
  "inferred_genres": ["드라마", "스릴러"],
  "includes_ending": false,
  "confidence": 95,
  "reasoning": "자막에서 '오늘 리뷰할 영화는 기생충입니다'로 제목 직접 언급됨. 2019년 작품 명시."
}

**예시 2: 클릭베이트 + 줄거리 역추론 (탱크/전쟁 영화)**
입력 자막: "2차 세계대전 당시 독일군의 최강 전차 티거... 연합군을 상대로 홀로 맞서 싸우는 장면이..."
출력:
{
  "extracted_titles": [],
  "inferred_titles": ["전차 티거"],
  "english_titles": ["Tiger"],
  "inferred_year": 2025,
  "inferred_genres": ["전쟁", "액션", "역사"],
  "includes_ending": false,
  "confidence": 75,
  "reasoning": "제목 직접 언급 없음. 2차 대전 독일 티거 전차 배경, 전쟁/액션 장르. '신작' 언급으로 2025년 추정."
}

**예시 3: 비리뷰 콘텐츠**
입력 자막: "2026년 현재 지상 최악의 감옥 TOP 8을 알아봅니다. 첫 번째는 ADX 플로렌스..."
출력:
{
  "extracted_titles": [],
  "inferred_titles": [],
  "english_titles": [],
  "inferred_year": null,
  "inferred_genres": [],
  "includes_ending": false,
  "confidence": 10,
  "reasoning": "영화/드라마 리뷰가 아닌 정보성 콘텐츠로 판단됨. 특정 작품을 리뷰하는 내용 없음"
}`;

  return `당신은 YouTube 영화/드라마 리뷰 영상 분석 전문가입니다.${runtimeInfo}

=== 분석 대상 ===
${content}

=== TMDB 후보 목록 ===
${candidatesInfo}
${fewShotExamples}

=== 단계별 분석 프로세스 (Chain-of-Thought) ===
다음 단계를 순서대로 수행하고, reasoning에 각 단계 결과를 기록하세요.

**0단계: 콘텐츠 유형 판별**
먼저 이 영상이 영화/드라마 리뷰인지 확인하세요:
- 리뷰 콘텐츠: 특정 영화/드라마의 줄거리, 평가, 분석을 다룸
- 비리뷰 콘텐츠: 일반 정보, 브이로그, 여러 작품 간략 나열만
→ 비리뷰로 판단되면 모든 titles를 빈 배열로, confidence를 20 이하로 반환

**1단계: 직접 언급 탐색 → extracted_titles**
자막에서 작품 제목이 명시적으로 언급되는지 찾으세요:
- "오늘 소개할 영화는 XXX", "이 영화는 XXX", "XXX라는 영화"
- "오늘의 영화 XXX", "XXX를 리뷰", "XXX 리뷰입니다"
- "넷플릭스 영화 XXX", "XXX라는 작품"
→ 찾은 한글 제목을 extracted_titles에 저장

**2단계: 줄거리 역추론 → inferred_titles**
1단계에서 제목을 찾지 못한 경우에만 시도:
- 자막의 스토리 전개, 캐릭터 이름/관계, 배경 설정 분석
- 언급된 배우, 감독, 플랫폼, 개봉연도 단서 활용
- 당신이 아는 영화/드라마 지식과 매칭
→ 실제 존재하는 작품만 inferred_titles에 저장

**2-1단계: 연도 추론 → inferred_year**
자막에서 개봉/방영 연도 힌트 찾기:
- 직접 언급: "2025년 개봉", "작년에 나온", "올해 신작"
- 간접 힌트: "신작", "최신", "공개와 동시에" → 최근 1-2년 내 작품
- 시대 배경과 혼동 주의: "1940년대 배경"은 개봉연도가 아님
→ 추정 연도를 inferred_year에 저장 (확실하지 않으면 null)

**2-2단계: 장르 추론 → inferred_genres**
자막 내용에서 장르 추론 (TMDB 후보 선택에 활용):
- 전쟁/탱크/군대 → ["전쟁", "액션"]
- 로맨스/사랑 → ["로맨스", "드라마"]
- 살인/수사/범인 → ["범죄", "스릴러"]
- 귀신/공포/저주 → ["공포"]
- 우주/외계인/SF → ["SF"]
→ 1-3개 장르를 inferred_genres에 저장

**3단계: 영어 원제 추출 → english_titles**
위에서 찾은 제목들의 영어 원제를 제공:
- 한글 음차 제목 → 실제 영어 원제 (예: "딥커버" → "Deep Cover")
- 한국 영화도 영어 제목 제공 (예: "기생충" → "Parasite")
→ english_titles에 저장 (TMDB 검색 정확도 향상용)

**4단계: 결말 포함 여부 판단**
다음 키워드/패턴 확인:
- 강한 신호: "결말", "엔딩", "스포일러", "반전", "최종화", 결말 장면 서술
- 약한 신호: "마지막" (문맥 확인 필요)
→ includes_ending 결정
${hasCandidates ? `
**5단계: TMDB 후보 선택**
위 후보 중 영상 내용과 가장 일치하는 작품 선택:
- 제목, 줄거리, 캐릭터, 배우/감독이 일치하는지 확인
- 일치하는 후보가 없으면 selected_tmdb를 null로
- confidence 50 미만이면 선택하지 않음` : ''}

=== 주의사항 (하지 마세요) ===
- 등장인물/캐릭터 이름을 제목으로 착각 (예: "뽀로로" → 등장인물일 수 있음)
- 작중 소품/장소/일기 이름을 제목으로 착각
- "명작", "수작", "갓작", "꿀잼" 등 평가어를 제목으로 착각
- "이 영화", "이 드라마" 같은 지시어를 제목으로 착각
- 존재하지 않는 가상의 제목 생성
- 한글+영어를 하나로 합치기: "기생충 (Parasite)" ❌ → "기생충", "Parasite" ✓

=== Confidence 점수 가이드라인 ===
- 90-100: 제목 3회 이상 명시적 언급, TMDB 후보와 완벽 일치
- 70-89: 제목 1-2회 언급 또는 줄거리 3개 이상 요소 일치
- 50-69: 줄거리 2개 요소 일치, 일부 불확실성
- 30-49: 추론 근거 약함, 여러 작품과 혼동 가능
- 0-29: 제목 추출 불가, 비리뷰 콘텐츠

=== 응답 형식 (JSON만) ===
{
  "extracted_titles": ["직접 언급된 한글 제목들"],
  "inferred_titles": ["줄거리 추론 한글 제목들"],
  "english_titles": ["영어 원제들"],
  "inferred_year": 2025 또는 null,
  "inferred_genres": ["전쟁", "액션"] 또는 [],
  "includes_ending": true/false,
  "confidence": 0-100,
  "reasoning": "0단계→1단계→2단계→... 순서로 분석 과정 기술"${hasCandidates ? `,
  "selected_tmdb": null 또는 {
    "index": 1,
    "tmdb_id": 12345,
    "type": "movie 또는 tv",
    "confidence": 0-100,
    "reasoning": "선택 이유"
  }` : ''}
}`;
}
