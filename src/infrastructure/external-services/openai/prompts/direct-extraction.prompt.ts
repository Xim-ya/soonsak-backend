/**
 * Phase 1: Direct Extraction Prompt
 * 자막에서 명시적으로 언급된 제목만 추출하는 간단하고 정확한 프롬프트
 *
 * 목표:
 * - 높은 정확도 (일반 명사 vs 실제 제목 구분)
 * - 빠른 응답 (복잡한 추론 불필요)
 * - confidence >= 80이면 Phase 2 스킵
 */

export interface DirectExtractionInput {
  /** 영상 제목 */
  videoTitle: string;
  /** 영상 설명 */
  videoDescription: string;
  /** 자막 앞부분 (800자) */
  transcriptStart: string;
  /** 자막 중간부분 (60-80% 구간, 1000자) - 작중 대사에서 제목 힌트 추출용 */
  transcriptMiddle: string;
  /** 자막 뒷부분 (800자) - 결말 판단용 */
  transcriptEnd: string;
  /** 대사 패턴에서 추출된 힌트 (예: "타임즈" from "저 타임즈 기자예요") */
  dialogueHint?: string;
  /** 영상 런타임 (초) - 결말 판단용 */
  runtimeSeconds?: number;
}

export interface DirectExtractionResult {
  /** 직접 추출된 제목 (명시적 언급만) */
  extractedTitle: string | null;
  /** 추출 신뢰도 (0-100) */
  confidence: number;
  /** 미디어 타입 힌트 */
  mediaTypeHint: 'movie' | 'tv' | 'anime' | 'documentary' | null;
  /** 추출 근거 */
  reasoning: string;
  /** 결말 포함 여부 (강한 신호만 감지) */
  includesEnding: boolean;
}

/**
 * Phase 1 직접 추출 프롬프트 생성
 */
export function buildDirectExtractionPrompt(input: DirectExtractionInput): string {
  const { videoTitle, videoDescription, transcriptStart, transcriptMiddle, transcriptEnd, dialogueHint, runtimeSeconds } = input;

  // 대사 패턴 힌트가 있으면 강조
  const hintSection = dialogueHint
    ? `\n**[사전 분석 결과]**: 자막에서 "${dialogueHint}"라는 기관명이 감지되었습니다. 이것이 드라마 제목일 가능성이 높습니다.\n`
    : '';

  // 런타임 정보
  const runtimeSection = runtimeSeconds
    ? `영상 런타임: ${runtimeSeconds}초 (${Math.round(runtimeSeconds / 60)}분)`
    : '';

  return `당신은 YouTube 영화/드라마 리뷰 영상에서 작품 제목을 추출하는 전문가입니다.
${hintSection}
=== 분석 대상 ===
영상 제목: ${videoTitle}
영상 설명: ${videoDescription || '(설명 없음)'}
${runtimeSection}

자막 앞부분 (800자):
${transcriptStart || '(자막 없음)'}

자막 중간부분 (60-80% 구간, 중요! 작중 대사가 많이 포함됨):
${transcriptMiddle || ''}

자막 뒷부분 (800자, 결말 판단에 중요):
${transcriptEnd || ''}

=== 추출 규칙 ===
다음 패턴에서 **명시적으로 언급된 제목만** 추출하세요:

**1. 리뷰어의 직접 소개 (가장 확실):**
- "오늘 리뷰할 영화는 XXX입니다"
- "이번에 소개할 드라마는 XXX"
- "XXX라는 영화를 보고 왔는데요"
- "넷플릭스 영화 XXX를 봤습니다"
- "XXX 리뷰입니다", "XXX 리뷰해봅니다"
- "XXX 시즌 2", "XXX 완결편", "XXX 후기"

**2. 작중 대사에서 제목 힌트 (드라마/기관명) - 중간 섹션에서 주로 발견:**
- "저 XXX 기자예요" → XXX가 방송사/신문사 이름이면 드라마 제목 가능
  - 예: "저 타임즈 기자예요" → "타임즈"
  - 예: "저 타임즈 이진우 기자예요" → "타임즈" (이름이 사이에 있어도 추출)
- "XXX 방송국", "XXX 신문사" 언급 → 언론사 배경 드라마 제목 힌트
- "XXX 고등학교", "XXX 대학교" 언급 → 학원물 제목 힌트
- 주의: 자막 중간부분에서 이러한 패턴을 **꼭 확인**하세요

**3. 영상 설명의 공식 제목:**
- 영화 제목이 대괄호/따옴표로 명시: [XXX], 'XXX', "XXX"
- "원제: XXX", "영어제목: XXX"

=== 제외해야 할 것 (중요!) ===

**일반 명사를 제목으로 착각하지 마세요:**
- "휴대폰", "핸드폰", "전화기" → 플롯 소품, 제목 아님
  - 예: "휴대폰으로 과거와 연결" → "휴대폰"은 제목이 아님
- "자동차", "집", "학교", "병원" → 배경/장소, 제목 아님
- "엄마", "아빠", "형", "누나" → 캐릭터 관계, 제목 아님

**클릭베이트 표현:**
- "갓작", "명작", "수작", "꿀잼", "개꿀", "레전드" → 평가어
- "이 영화", "이 드라마", "그 작품" → 지시어

**캐릭터/배우 이름:**
- 등장인물 이름을 제목으로 착각하지 말 것
- 배우 이름과 영화 제목 구분

**설명형 클릭베이트 표현 (매우 중요!):**
- 《힘을 숨긴 XXX》, 《XXX하는 사람들》, 《XXX된 남자》 → 설명형 표현, 제목 아님!
- 패턴: "~하는", "~된", "~의 최후", "~들" 등이 《》 또는 [] 안에 있으면 콘텐츠 설명
- 예: 《힘을 숨긴 할아버지들》 → 실제 제목이 아니라 클릭베이트 설명
- 실제 제목은 고유명사: 기생충, 옐로우스톤, 발레리나 등

**비유적 제목 언급 (매우 중요!):**
- "파묘 무당조차", "기생충급 반전", "인터스텔라 같은" → 비유일 뿐, 리뷰 대상 아님!
- 비유 접미사 감지: "XXX급", "XXX조차", "XXX처럼", "XXX 같은", "XXX 뺨치는"
- 이런 패턴의 XXX는 extracted_title에 사용하지 말 것

=== Few-shot 예시 ===

**예시 1: 직접 언급 성공**
자막: "오늘은 넷플릭스에서 화제가 된 영화 글래스 어니언을 리뷰해보겠습니다"
결과:
{
  "extracted_title": "글래스 어니언",
  "confidence": 95,
  "media_type_hint": "movie",
  "reasoning": "리뷰어가 '영화 글래스 어니언을 리뷰'라고 직접 언급",
  "includes_ending": false
}

**예시 2: 작중 대사에서 추출 (중간 섹션에서 발견)**
자막 중간부분: "저 타임즈 이진우 기자예요. 네. 무슨 일이신데요? 아, 인터뷰 질문지 때문에..."
결과:
{
  "extracted_title": "타임즈",
  "confidence": 85,
  "media_type_hint": "tv",
  "reasoning": "작중 대사에서 '저 타임즈 이진우 기자예요' 패턴 발견 - 언론사 배경 드라마",
  "includes_ending": false
}

**예시 3: 일반 명사 - 제목 추출 실패**
제목: "휴대폰 하나로 시간을 넘나드는 충격적 전개..."
자막: "주인공이 휴대폰을 발견하는데... 이 휴대폰으로 과거와 연결이 되면서..."
결과:
{
  "extracted_title": null,
  "confidence": 0,
  "media_type_hint": "movie",
  "reasoning": "'휴대폰'은 플롯 소품이지 제목이 아님. 리뷰어가 영화 제목을 직접 언급하지 않음",
  "includes_ending": false
}

**예시 4: 클릭베이트만 있고 제목 없음**
제목: "넷플릭스 역대급 갓작..."
자막: "이번 영화는 정말 충격적인데요... 주인공이 살인 사건에 휘말리면서..."
결과:
{
  "extracted_title": null,
  "confidence": 0,
  "media_type_hint": "movie",
  "reasoning": "영화 제목이 직접 언급되지 않음. '갓작'은 평가어",
  "includes_ending": false
}

**예시 5: 결말포함 콘텐츠**
자막: "기생충 결말까지 완벽 리뷰해봅니다... 마지막 반전이 정말..."
결과:
{
  "extracted_title": "기생충",
  "confidence": 90,
  "media_type_hint": "movie",
  "reasoning": "'기생충 결말까지' 직접 언급. 결말/반전 키워드 포함",
  "includes_ending": true
}

**예시 6: 애니메이션**
자막: "스즈메의 문단속 후기입니다... 신카이 마코토 감독의 신작..."
결과:
{
  "extracted_title": "스즈메의 문단속",
  "confidence": 95,
  "media_type_hint": "anime",
  "reasoning": "'스즈메의 문단속 후기' 직접 언급. 신카이 마코토 감독 = 애니메이션",
  "includes_ending": false
}

**예시 7: 설명형 클릭베이트 - 제목 추출 실패 (중요!)**
제목: "《힘을 숨긴 할아버지들》의 미개봉 범죄 액션"
자막: "이 영화는 은퇴한 노인들이 범죄 조직에 맞서는 이야기입니다..."
결과:
{
  "extracted_title": null,
  "confidence": 0,
  "media_type_hint": "movie",
  "reasoning": "'힘을 숨긴 할아버지들'은 설명형 표현(동사+형용사 조합)이며 실제 제목이 아님. 리뷰어가 영화 제목을 직접 언급하지 않음",
  "includes_ending": false
}

**예시 8: 비유적 표현 - 제목 추출 주의 (중요!)**
제목: "파묘 무당조차 감당 못하는 거대한 괴수의 정체"
자막: "이번 드라마에서 등장하는 괴물은 정말 무섭습니다..."
결과:
{
  "extracted_title": null,
  "confidence": 0,
  "media_type_hint": "tv",
  "reasoning": "'파묘'는 비유적 표현('파묘급', '파묘 무당조차')으로 사용됨. 실제 리뷰 대상이 아님. 자막에서 실제 제목 언급 없음",
  "includes_ending": false
}

**예시 9: 배우만 언급 - 낮은 신뢰도**
제목: "마동석이 깜빵에 있는데 폭동이 일어나면 벌어지는 일"
자막: "마동석 배우가 이번에도 강력한 액션을 보여주는데요..."
결과:
{
  "extracted_title": null,
  "confidence": 0,
  "media_type_hint": "movie",
  "reasoning": "배우명(마동석)만 언급되고 영화 제목은 직접 언급되지 않음. 마동석 출연 교도소/범죄 영화 다수 존재하여 특정 불가",
  "includes_ending": false
}

=== 결말 포함 여부 판단 ===

**1. 제목에 명시적 키워드가 있으면 무조건 true:**
- "결말", "결말포함", "엔딩", "스포일러", "최종화"
- 이 키워드가 있으면 다른 조건 무시하고 includes_ending = true

**2. 키워드가 없으면 자막 끝부분(transcriptEnd)으로 판단:**

결말포함 O 패턴 (includes_ending = true):
- "마무리됩니다", "끝납니다", "이야기는 마무리되고"
- "이상 XXX였습니다" (작품명으로 마무리)
- 스토리가 어떻게 끝났는지 서술 (주인공 운명, 사건 해결 등)

결말포함 X 패턴 (includes_ending = false):
- "극장에서 보세요", "극장에서 보시면 좋을 것 같습니다"
- "풀무비", "풀영상", "본편을 보시면"
- "시청해 보시길 추천드립니다", "볼 수 있는 플랫폼은..."
- "꼭 보세요", "직접 확인해보세요"
- 스토리가 질문으로 끝남: "XXX 수 있을지?", "XXX 될까요?" (클리프행어)
- 스토리 결말 없이 "재밌는 작품으로 돌아오겠습니다"로 끝남

**3. 무시해야 할 것:**
- "몰아보기" - 결말포함 지표 아님
- 런타임 - 결말 판단에 무관

**판단 우선순위:**
1. 제목에 "결말", "스포일러" 키워드 → true
2. 자막 끝에 "시청해 보시길 추천", "극장에서 보세요" 등 풀영상 추천 → false
3. 자막 끝이 질문으로 끝남 ("XXX 수 있을지?") → false (클리프행어)
4. 자막 끝에 "마무리됩니다" 등 스토리 엔딩 서술 → true
5. 둘 다 없으면 → false

=== 신뢰도 가이드라인 ===
- 90-100: 제목이 "XXX 리뷰", "영화 XXX" 형태로 명확히 언급
- 80-89: 작중 대사에서 기관명/작품명 반복 언급 (3회 이상)
- 60-79: 영상 설명에만 제목 있고 자막에서 확인 안됨
- 40-59: 추정되지만 확실하지 않음
- 0-39: 직접 언급 없음 (Phase 2 필요)

=== 응답 형식 (JSON만) ===
{
  "extracted_title": "직접 언급된 제목" 또는 null,
  "confidence": 0-100,
  "media_type_hint": "movie" | "tv" | "anime" | "documentary" | null,
  "reasoning": "추출 근거 설명",
  "includes_ending": true/false
}`;
}
