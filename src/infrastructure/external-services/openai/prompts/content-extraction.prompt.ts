/**
 * 콘텐츠 추출 프롬프트
 * TMDB 후보가 없을 때 영화/드라마 제목 추출용
 */
export function buildContentExtractionPrompt(
  content: string,
  runtimeSeconds?: number,
): string {
  const runtimeInfo = runtimeSeconds
    ? `\n영상 재생 시간: ${runtimeSeconds}초 (${Math.round(runtimeSeconds / 60)}분)`
    : '';

  return `당신은 YouTube 영화/드라마 리뷰 영상 분석 전문가입니다.

아래의 **제목**, **설명**, **자막**을 종합적으로 분석하여 이 영상에서 다루는 영화/드라마의 제목을 추출해주세요.${runtimeInfo}

=== 분석 대상 ===
${content}

=== 분석 방법 ===
1. **자막 분석 (가장 중요)**
   - 자막에서 영화/드라마 제목이 직접 언급되는 부분을 찾으세요
   - "오늘 소개할 영화는 XXX", "XXX라는 영화", "XXX 리뷰" 등의 패턴을 찾으세요

2. **설명 분석**
   - 영상 설명에 영화 제목이 포함되어 있는지 확인하세요

3. **제목 분석**
   - 영상 제목에서 영화명을 유추할 수 있는 단서를 찾으세요

=== 추출 규칙 ===
- 반드시 **명시적으로 언급된 제목**만 추출하세요
- 줄거리나 내용으로 추측하지 마세요
- 배우, 감독, 채널 이름은 제외
- 한국어 제목과 영어 원제 모두 추출
- 확신이 70% 미만이면 빈 배열 반환

=== 응답 형식 (JSON만) ===
{
  "extracted_titles": ["찾은 제목들"],
  "includes_ending": true/false,
  "confidence": 0-100,
  "source": "title/description/transcript 중 어디서 찾았는지",
  "reasoning": "구체적인 발견 근거"
}`;
}
