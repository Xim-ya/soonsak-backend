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

  // Few-shot 예시 (클릭베이트 대응 강화 + 웹 검색어 생성)
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
  "search_queries": [],
  "includes_ending": false,
  "confidence": 95,
  "reasoning": "자막에서 '오늘 리뷰할 영화는 기생충입니다'로 제목 직접 언급됨. 2019년 작품 명시."
}

**예시 2: 클릭베이트 + 제목 모름 → 줄거리 기반 웹 검색어**
입력 제목: "전직 레인저를 건드려버린 곰의 최후..."
입력 자막: "은퇴한 레인저가 산속에서 은둔 생활 중 거대한 곰에게 습격당하고... 복수를 위해..."
출력:
{
  "extracted_titles": [],
  "inferred_titles": [],
  "english_titles": [],
  "inferred_year": null,
  "inferred_genres": ["스릴러", "액션"],
  "search_queries": ["bear attack ranger revenge movie", "forest bear survival movie", "곰 공격 레인저 영화"],
  "includes_ending": true,
  "confidence": 30,
  "reasoning": "제목 직접 언급 없음. 줄거리 키워드(곰, 레인저, 복수)로 검색어 생성. 연도 불확실하여 생략."
}

**예시 2-1: 종말 영화 + 독특한 설정 → 설정 기반 검색어**
입력 제목: "클릭하면 멈출 수 없는 수작..."
입력 자막: "호주에 운석이 충돌하면서... 남은 시간은 12시간... 마지막 파티를 즐기려는..."
출력:
{
  "extracted_titles": [],
  "inferred_titles": [],
  "english_titles": [],
  "inferred_year": null,
  "inferred_genres": ["드라마", "SF"],
  "search_queries": ["Australia meteor apocalypse movie", "final hours end of world movie", "호주 종말 영화", "last party apocalypse film"],
  "includes_ending": true,
  "confidence": 30,
  "reasoning": "제목 불명. 호주+운석+종말+파티 설정으로 검색어 생성. 독특한 국가 설정(호주) 포함."
}

**예시 3: 배우/감독 힌트 활용**
입력 자막: "라이언 고슬링이 CIA 암살 요원으로 등장하는... 추격전이 전 세계로 확대되면서..."
출력:
{
  "extracted_titles": [],
  "inferred_titles": ["그레이 맨"],
  "english_titles": ["The Gray Man"],
  "inferred_year": 2022,
  "inferred_genres": ["액션", "스릴러"],
  "search_queries": ["Ryan Gosling CIA assassin movie", "라이언 고슬링 CIA 영화"],
  "includes_ending": false,
  "confidence": 80,
  "reasoning": "라이언 고슬링 + CIA 암살 요원 → '그레이 맨' 추론. 배우+역할 조합으로 높은 신뢰도."
}

**예시 4: 비리뷰 콘텐츠**
입력 자막: "2026년 현재 지상 최악의 감옥 TOP 8을 알아봅니다. 첫 번째는 ADX 플로렌스..."
출력:
{
  "extracted_titles": [],
  "inferred_titles": [],
  "english_titles": [],
  "inferred_year": null,
  "inferred_genres": [],
  "search_queries": [],
  "includes_ending": false,
  "confidence": 10,
  "reasoning": "영화/드라마 리뷰가 아닌 정보성 콘텐츠로 판단됨. 특정 작품을 리뷰하는 내용 없음"
}

**예시 5: 배우명 + 시간 플롯 요소 → 특정 검색어 (핵심 예시!)**
입력 제목: "🔥남궁민이 떴다!!🔥'28년 전 비극'으로 인해 괴물이 된 남궁민의 역대급 미스터리 추리극!!"
입력 자막: "특수부대 출신의 경찰관이 28년 전 마을에서 벌어진 사건의 진실을 추적하면서..."
출력:
{
  "extracted_titles": [],
  "inferred_titles": [],
  "english_titles": [],
  "inferred_year": 2020,
  "inferred_genres": ["드라마", "스릴러", "미스터리"],
  "search_queries": ["남궁민 28년 전 드라마", "Nam Goong Min 28 years ago drama", "28년 전 사건 미스터리 드라마", "남궁민 특수부대 경찰 드라마"],
  "includes_ending": true,
  "confidence": 40,
  "reasoning": "0단계: 드라마 리뷰 콘텐츠. 1단계: 제목 직접 언급 없음. 2단계: 남궁민 주연, 28년 전 사건 추적 플롯. 3-1단계: '28년 전'이 핵심 플롯 요소이므로 검색어에 반드시 포함."
}

**예시 6: 설명형 클릭베이트 - 제목 추출 실패 (핵심 예시!)**
입력 제목: "《힘을 숨긴 할아버지들》의 미개봉 범죄 액션 [영화리뷰 결말포함]"
입력 자막: "은퇴한 노인들이 범죄 조직에 맞서 싸우는 영화입니다. 주인공 프랭크는..."
출력:
{
  "extracted_titles": [],
  "inferred_titles": [],
  "english_titles": [],
  "inferred_year": 2014,
  "inferred_genres": ["액션", "범죄", "코미디"],
  "search_queries": ["retired old men crime movie", "노인 범죄 조직 액션 영화", "elderly vigilante action film"],
  "includes_ending": true,
  "confidence": 25,
  "reasoning": "0단계: 영화 리뷰 콘텐츠. 1단계: '힘을 숨긴 할아버지들'은 설명형 표현(동사+형용사 조합)이며 실제 제목이 아님. 2단계: 은퇴 노인 + 범죄 조직 대결 플롯. 제목 직접 언급 없어 검색어 생성."
}

**예시 7: 비유적 표현 - 잘못된 제목 추출 방지 (핵심 예시!)**
입력 제목: "파묘 무당조차 감당 못하는 거대한 괴수의 정체 ㄷㄷ"
입력 자막: "이번 드라마 감자연구소에서 등장하는 괴물은 정말 무섭습니다..."
출력:
{
  "extracted_titles": ["감자연구소"],
  "inferred_titles": [],
  "english_titles": [],
  "inferred_year": 2025,
  "inferred_genres": ["드라마", "미스터리", "공포"],
  "search_queries": [],
  "includes_ending": false,
  "confidence": 85,
  "reasoning": "0단계: 드라마 리뷰 콘텐츠. 1단계: '파묘'는 비유적 표현('파묘 무당조차')으로 사용됨 - 리뷰 대상 아님! 자막에서 '드라마 감자연구소'로 실제 제목 직접 언급됨."
}

**예시 8: 동명 작품 disambiguation (핵심 예시!)**
입력 제목: "넷플릭스 밤샘시리즈... 라이프 [결말포함]"
입력 자막: "우주 정거장에서 외계 생명체가 발견되고... 승무원들이 하나씩..."
출력:
{
  "extracted_titles": ["라이프"],
  "inferred_titles": [],
  "english_titles": ["Life"],
  "inferred_year": 2017,
  "inferred_genres": ["SF", "공포", "스릴러"],
  "search_queries": [],
  "includes_ending": true,
  "confidence": 90,
  "reasoning": "0단계: 영화 리뷰 콘텐츠. 1단계: '라이프' 직접 언급. 주의: 동명 작품 다수! 2-1단계: 우주 정거장 + 외계 생명체 → SF영화 Life(2017) 특정. 한국 드라마 '라이프'(병원 배경)와 구분됨."
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
- 리뷰어가 직접 말함: "오늘 소개할 영화는 XXX", "이 영화는 XXX", "XXX라는 영화"
- 제목 언급 패턴: "오늘의 영화 XXX", "XXX를 리뷰", "XXX 리뷰입니다"
- 플랫폼 언급: "넷플릭스 영화 XXX", "XXX라는 작품"
- ⚠️ **작중 대사에서 제목 추출** (중요!):
  - "저 XXX 기자예요" → XXX가 방송사/신문사 이름이면 드라마 제목일 가능성
  - "XXX 방송국", "XXX 신문사" 언급 → 드라마 배경이 언론사인 경우 제목 힌트
  - 예: "저 타임즈 기자예요" → "타임즈"가 드라마 제목
→ 찾은 한글 제목을 extracted_titles에 저장

**2단계: 줄거리 역추론 → inferred_titles**
1단계에서 제목을 찾지 못한 경우에만 시도:
- 자막의 스토리 전개, 캐릭터 이름/관계, 배경 설정 분석
- 언급된 배우, 감독, 플랫폼, 개봉연도 단서 활용
- 당신이 아는 영화/드라마 지식과 매칭
→ 실제 존재하는 작품만 inferred_titles에 저장

**2-1단계: 연도 추론 → inferred_year (중요!)**
자막에서 개봉/방영 연도 힌트 찾기:
- 직접 언급: "2025년 개봉", "작년에 나온", "올해 신작"
- 간접 힌트: "신작", "최신", "공개와 동시에", "넷플릭스 신작" → 2025년
- 아무 연도 힌트가 없지만 알려지지 않은 영화 → 2025년 추정 (최근 업로드된 리뷰는 보통 신작)
- 시대 배경과 혼동 주의: "1940년대 배경"은 개봉연도가 아님
- 유명하지 않거나 처음 듣는 영화 → 높은 확률로 2024-2025년 신작
→ 추정 연도를 inferred_year에 저장

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

**3-1단계: 웹 검색어 생성 → search_queries (매우 중요!)**
1-3단계에서 제목 확신이 낮은 경우, 웹 검색용 쿼리 생성:

⚠️ **중요: 추론한 제목을 검색어에 넣지 마세요!** ⚠️
- ❌ 잘못된 예: "The Final Hour movie" (추론 제목 사용)
- ✅ 올바른 예: "Australia meteor apocalypse movie" (줄거리 키워드 사용)

검색어 생성 규칙:
1. **자막에서 언급된 실제 줄거리 키워드 사용**
   - 국가/도시명: "Australia", "Paris", "Tokyo", "호주", "파리"
   - 특수 상황: 운석 충돌, 좀비, 외계인, 종말, 지진 등
   - 핵심 플롯: 주인공 직업, 주요 이벤트
2. **⭐ 시간 관련 플롯 요소 필수 포함 (핵심!):**
   - 과거 사건: "28년 전", "10년 전", "20년 전의 비밀" → 검색어에 반드시 포함!
   - 예: "28년 전 비극" → "28 years ago drama", "28년 전 사건 드라마"
   - 이런 시간 요소는 작품을 구별하는 핵심 단서임
3. **연도 포함 전략**: 최소 1개 검색어에 연도 포함
   - 유명하지 않은 영화 → 2024-2025 신작일 가능성 높음
   - 오래된 듯한 영화 (흑백, 레트로 분위기) → 연도 생략
4. **영어 + 한글 검색어 모두 생성**
5. **배우명 + 플롯 요소 조합**: 배우 이름이 있으면 반드시 플롯 요소와 함께
   - 예: "남궁민" + "28년 전" → "남궁민 28년 전 드라마", "Nam Goong Min 28 years ago"

예시:
- 호주 + 운석 + 종말 → ["Australia meteor apocalypse movie", "호주 종말 영화", "end of world Australia"]
- 곰 + 레인저 + 복수 → ["bear attack ranger movie 2025", "곰 공격 영화 2025"]
- 12시간 남은 종말 → ["12 hours left apocalypse movie", "종말까지 12시간 영화"]
- 남궁민 + 28년 전 비극 → ["남궁민 28년 전 드라마", "Nam Goong Min 28 years ago drama", "28년 전 사건 미스터리"]
→ 3-4개의 다양한 검색어 생성 (줄거리 키워드 + 시간 요소 기반!)

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
- ⚠️ **일반 명사를 제목으로 착각**:
  - "휴대폰", "핸드폰", "전화", "전화기" → 플롯 소품, 제목 아님
  - "자동차", "집", "학교", "병원" → 배경/장소, 제목 아님
  - 예: "휴대폰으로 과거와 연결" → "휴대폰"은 제목이 아니라 플롯 설명
  - 일반 명사가 제목처럼 보이면 작중 대사에서 실제 제목 찾기

- ⚠️ **설명형 클릭베이트 표현을 제목으로 착각** (매우 중요!):
  - 《힘을 숨긴 XXX》, 《XXX하는 사람들》, 《XXX된 남자》 → 설명형 표현, 제목 아님!
  - 패턴 감지: "~하는", "~된", "~의 최후", "~들" 등이 《》 또는 [] 안에 있으면 제목 아님
  - 예: 《힘을 숨긴 할아버지들》 → "힘을 숨긴"은 동사+형용사 조합, 실제 제목이 아니라 콘텐츠 설명
  - 예: [XXX하면 벌어지는 일] → 클릭베이트 설명문, 제목 아님
  - 실제 제목은 고유명사 형태: 기생충, 옐로우스톤, 발레리나, 라이프 등

- ⚠️ **비유적 제목 언급을 실제 제목으로 착각** (매우 중요!):
  - "파묘 무당조차 감당 못하는" → '파묘'는 비유적 표현, 실제 리뷰 대상 아님!
  - "기생충급 반전", "인터스텔라 같은 감동" → 비유일 뿐, 리뷰 대상 아님
  - 비유 접미사 감지: "XXX급", "XXX조차", "XXX처럼", "XXX 같은", "XXX 뺨치는"
  - 이런 패턴의 XXX는 extracted_titles에 포함하지 말 것

- ⚠️ **동명 작품 혼동 주의** (disambiguation 필수):
  - 흔한 제목: 라이프, 홈, 마더, 아서, 소울, 패러다이스 등
  - 이런 제목 발견 시 반드시 연도/장르/배우/플랫폼 정보 확인
  - TMDB 후보 2개 이상이면: (1) 가장 최근작 (2) 가장 인기작 우선
  - 예: "라이프" → SF영화(2017), 한국드라마(2018), 다큐 등 구분 필요

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
  "search_queries": ["웹 검색어들 - 제목 추론 실패 시 필수"],
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
