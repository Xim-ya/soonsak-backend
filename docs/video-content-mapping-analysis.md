# 비디오-콘텐츠 매핑 파이프라인

> YouTube 영화/드라마 리뷰 영상 → TMDB 콘텐츠 매핑 흐름

---

## 전체 흐름

```
영상 등록 요청
  │
  ├─ 1. 중복 체크 ──→ 이미 등록됨 → 스킵
  │
  ├─ 2. YouTube 메타데이터 추출 ──→ Shorts → 스킵
  │
  ├─ 3. AI 자막 분석 (항상 먼저 실행, gpt-4o-mini, temp=0.1)
  │     입력: 제목 + 설명 + 자막 (TMDB 후보 없이 순수 추출)
  │     출력: 직접 언급 제목(extracted) + 줄거리 추론 제목(inferred) + 결말 판단
  │     response_format: json_object (구조화된 JSON 보장)
  │     │
  │     ├─ 3-1. 직접 언급 제목 → TMDB 검색 → 매칭
  │     │   ├─ 고신뢰도 매칭 (path: ai-high-confidence)
  │     │   ├─ 스코어링 매칭 (path: ai-extracted)
  │     │   └─ 단일 결과 신뢰 (path: ai-single)
  │     │
  │     ├─ 3-2. 직접 언급 실패 → 줄거리 추론 제목 폴백 → TMDB 검색 → 매칭
  │     │   ├─ 고신뢰도 매칭 (path: ai-inferred-high-confidence)
  │     │   ├─ 스코어링 매칭 (path: ai-inferred-extracted)
  │     │   └─ 단일 결과 신뢰 (path: ai-inferred-single)
  │     │
  │     └─ 매칭 실패 → 다음 단계
  │
  ├─ 4. YouTube 제목 후보 폴백 (AI 매칭 실패 시)
  │     정규식 12+ 패턴으로 제목 후보 추출
  │     일반 용어("명작", "수작", "몰아보기" 등) 필터링
  │     TMDB 병렬 검색 → 고신뢰도 매칭 (path: yt-high-confidence)
  │
  ├─ 5. Scoring fallback
  │     AI 추출 제목 + YouTube 제목 후보 합산
  │     Dice 유사도 + 연도 + 인기도 가중치 → 최소 점수(4) 이상만 수락
  │
  └─ 6. 저장
        TMDB 상세 조회 → Content 저장 → Channel 저장 → Video 저장
        Primary 비디오 결정 (결말포함 우선 → 긴 런타임 우선)
```

---

## 매칭 경로 요약

| 경로 | 조건 | AI 호출 |
|:-----|:-----|:-------:|
| `ai-high-confidence` | AI 직접 추출 제목 → TMDB Dice >= 0.95 | 1회 |
| `ai-extracted` | AI 직접 추출 제목 → TMDB 스코어링 매칭 | 1회 |
| `ai-single` | AI 직접 추출 제목 → TMDB 결과 1건 → 신뢰 채택 | 1회 |
| `ai-inferred-*` | AI 줄거리 추론 제목 → TMDB 매칭 (직접 추출 실패 시 폴백) | 1회 |
| `yt-high-confidence` | YouTube 제목 → TMDB Dice >= 0.95 | 1회 |
| `scoring-fallback` | 전체 후보 합산 가중치 스코어링 (최소 4점) | 1회 |

---

## 주요 컴포넌트

### 제목 후보 추출 (`TitleExtractionService`)

YouTube 제목/설명에서 정규식으로 영화 제목 후보를 추출한다.

**추출 패턴 (제목):** pipe(`|`), 대괄호(`[]`), dash(`-`), 소괄호(`()`), 인용(`""`)
**추출 패턴 (설명):** 첫 줄, 특수/일반 인용부호, 원제 라벨, 인라인 연도, 해시태그, 이모지 접두사

**필터링:** `명작`, `수작`, `몰아보기`, `드라마몰아보기`, `폭풍감동`, `애플tv`, `한국영화`, `영화리뷰` 등 일반 용어 제거 (정확 일치 + 접미사 기반)

### TMDB 검색 (`TMDBAdapter`)

```
검색 쿼리 → ko-KR 검색 (최대 5건)
              └─ 5건 미만 → en-US 폴백 (최대 8건 총합, ID 중복 제거)
              └─ person 타입 제외, movie/tv만 반환
```

- 쿼리 확장: 한글+숫자 공백 정규화 (`"조폭마누라2"` → `"조폭마누라 2"` 추가)
- 연도 힌트: 제목/설명에서 `(YYYY)` 패턴 추출하여 검색 정밀도 향상
- 재시도: 최대 3회, 500ms 지수 백오프

### AI 분석 (`OpenAIAdapter`)

후보 없이 순수 자막 분석으로 3가지 수행:
1. **직접 언급 제목 추출 (extracted_titles)** — 자막에서 `"오늘 소개할 영화는 XXX"` 등의 패턴 탐색
2. **줄거리 추론 제목 (inferred_titles)** — 직접 언급이 없을 때 자막의 줄거리·배우·감독 등을 분석하여 추론
3. **결말 판단** — 스포일러/결말 포함 여부

입력 자막 세그먼트: 시작(300자) + 중간(500자, 40%지점) + 끝(300자)
모델: `gpt-4o-mini`, temperature=0.1, 재시도 2회, `response_format: json_object`

### 스코어링 (`PrimaryVideoSelectionService`)

| 항목 | 점수 |
|:-----|:----:|
| 제목 정확 일치 (Dice=1.0) | +10 |
| 연도 일치 | +8 |
| 높은 유사도 (Dice>=0.8) | +7 |
| 영화 이모지 보너스 | +5 |
| 중간 유사도 (Dice>=0.6) | +4 |
| 첫 번째 후보 보너스 | +2 |
| **최소 수락 점수** | **4** |

### 결말 감지 (`EndingDetectionService`)

키워드 기반: `결말포함`, `결말`, `엔딩`, `스포일러`, `최종화`, `완결` 등
시리즈 패턴: `전편`, `총집편`, `몰아보기`, 다중 시즌(3개+)

---

## 폴백 체인

```
AI 자막 분석 (항상 먼저 실행)
 ├─ 직접 언급 제목 (extracted_titles) → TMDB 검색 → 매칭
 │   ├─ 고신뢰도/스코어링/단일결과 → 완료 (ai-*)
 │   └─ 실패 ↓
 │
 ├─ 줄거리 추론 제목 (inferred_titles) → TMDB 검색 → 매칭
 │   ├─ 고신뢰도/스코어링/단일결과 → 완료 (ai-inferred-*)
 │   └─ 실패 ↓
 │
 └─ YouTube 제목 후보 폴백
      ├─ 고신뢰도 매칭 → 완료 (yt-high-confidence)
      └─ Scoring fallback (전체 합산)
           ├─ 최소 점수(4) 이상 → 완료
           └─ 미달 → 매칭 실패
```

---

## 파일 참조

| 파일 | 역할 |
|:-----|:-----|
| `register-video.use-case.ts` | 파이프라인 오케스트레이터 |
| `title-extraction.service.ts` | 제목 후보 추출 (12+ 패턴) |
| `primary-video-selection.service.ts` | 스코어링 기반 선택 |
| `ending-detection.service.ts` | 결말 감지 |
| `openai.adapter.ts` | AI 분석 어댑터 |
| `unified-analysis.prompt.ts` | AI 프롬프트 |
| `tmdb.adapter.ts` | TMDB 검색 어댑터 |
| `config.ts` | 설정 상수 (MIN_MATCH_SCORE 등) |
