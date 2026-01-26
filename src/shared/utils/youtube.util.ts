/**
 * YouTube URL/ID 유틸리티
 */

const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

const URL_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
];

/**
 * URL에서 YouTube 비디오 ID 추출 또는 기존 ID 검증
 */
export function extractVideoId(urlOrId: string): string | null {
  if (VIDEO_ID_REGEX.test(urlOrId)) {
    return urlOrId;
  }

  for (const pattern of URL_PATTERNS) {
    const match = urlOrId.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * RSS URL에서 채널 ID 추출
 */
export function extractChannelIdFromRSS(rssUrl: string): string | null {
  const match = rssUrl.match(/channel_id=([^&]+)/);
  return match?.[1] ?? null;
}

/**
 * 채널 ID로 YouTube RSS 피드 URL 생성
 */
export function buildRSSUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

/**
 * ISO 8601 형식의 duration을 초 단위로 변환
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0');
  const seconds = parseInt(match[3] || '0');

  return hours * 3600 + minutes * 60 + seconds;
}
