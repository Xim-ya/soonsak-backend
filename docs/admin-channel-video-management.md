# 관리자 채널/영상 관리 기능 구현 가이드

## 개요
관리자 앱에서 YouTube 채널과 영상을 수동으로 추가/관리할 수 있는 기능을 구현합니다.

---

## 아키텍처

```
┌─────────────┐      ┌─────────────────┐
│  관리자 앱   │ ──▶  │  NestJS 백엔드   │
│  (Flutter)  │      │  (Railway)      │
└─────────────┘      └─────────────────┘
```

**직접 호출** - Edge Function 불필요

---

## 백엔드 API

### Base URL
```typescript
const BACKEND_URL = 'https://your-backend.up.railway.app';
```

### 1. 단일 영상 등록
```
POST /videos/:videoId/register
```

**처리 흐름:**
1. YouTube API로 영상 정보 조회
2. AI 자막 분석 (OpenAI)
3. TMDB 매칭
4. DB 저장 (콘텐츠 + 비디오)

**응답:**
```json
{
  "success": true,
  "videoId": "dQw4w9WgXcQ",
  "contentId": 12345,
  "contentType": "movie",
  "title": "영화 제목",
  "message": "비디오가 성공적으로 등록되었습니다."
}
```

### 2. 채널 등록 (최근 영상)
```
POST /channels/:channelId/register
```

**처리 흐름:**
1. RSS 피드로 최근 영상 조회
2. 각 영상 순차 등록 (3초 딜레이)

### 3. 채널 전체 영상 등록
```
POST /channels/:channelId/register-all?maxVideos=100
```

**처리 흐름:**
1. YouTube API로 전체 영상 조회
2. 이미 등록된 영상 필터링
3. 새 영상 순차 등록 (2초 딜레이)

**응답:**
```json
{
  "success": true,
  "channelId": "UCxxxxxxxxxxxxxx",
  "channelName": "채널 이름",
  "totalVideos": 150,
  "registeredCount": 45,
  "skippedCount": 5,
  "failedCount": 0
}
```

---

## 프론트엔드 API (Flutter/Dart)

```dart
const BACKEND_URL = String.fromEnvironment('BACKEND_URL');

class AdminRegistrationApi {
  final Dio _dio;

  AdminRegistrationApi(this._dio);

  /// 단일 영상 등록
  Future<VideoRegistrationResult> registerVideo(String videoId) async {
    final response = await _dio.post('$BACKEND_URL/videos/$videoId/register');
    return VideoRegistrationResult.fromJson(response.data);
  }

  /// 채널 최근 영상 등록
  Future<ChannelRegistrationResult> registerChannel(
    String channelId, {
    int maxVideos = 10,
  }) async {
    final response = await _dio.post(
      '$BACKEND_URL/channels/$channelId/register',
      data: {'maxVideos': maxVideos},
    );
    return ChannelRegistrationResult.fromJson(response.data);
  }

  /// 채널 전체 영상 등록
  Future<ChannelRegistrationResult> registerChannelAll(String channelId) async {
    final response = await _dio.post(
      '$BACKEND_URL/channels/$channelId/register-all',
    );
    return ChannelRegistrationResult.fromJson(response.data);
  }

  /// 여러 영상 일괄 등록
  Future<BatchRegistrationResult> registerVideos(
    List<String> videoIds, {
    void Function(int current, int total)? onProgress,
  }) async {
    final results = <VideoRegistrationResult>[];

    for (var i = 0; i < videoIds.length; i++) {
      onProgress?.call(i + 1, videoIds.length);

      try {
        final result = await registerVideo(videoIds[i]);
        results.add(result);
      } catch (e) {
        results.add(VideoRegistrationResult.failed(videoIds[i], e.toString()));
      }
    }

    return BatchRegistrationResult(results);
  }
}
```

---

## 구현 체크리스트

### 백엔드
- [ ] CORS 설정 (관리자 앱 도메인 허용)
- [ ] `/videos/:videoId/register` 동작 확인
- [ ] `/channels/:channelId/register` 동작 확인
- [ ] `/channels/:channelId/register-all` 동작 확인

### 프론트엔드
- [ ] `BACKEND_URL` 환경변수 설정
- [ ] `AdminRegistrationApi` 구현
- [ ] 채널 추가 UI
- [ ] 영상 추가 UI

---

## 에러 코드

| HTTP | 의미 | 대응 |
|------|------|------|
| 400 | 잘못된 요청 | 파라미터 확인 |
| 404 | 영상/채널 없음 | URL 확인 |
| 409 | 이미 등록됨 | 스킵 처리 |
| 422 | 쇼츠/처리불가 | 안내 메시지 |
| 500 | 서버 에러 | 재시도 |
