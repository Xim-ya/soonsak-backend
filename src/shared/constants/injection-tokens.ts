/**
 * 의존성 주입 토큰
 * 인터페이스 기반 DI를 위한 심볼 토큰
 */
export const INJECTION_TOKENS = {
  // 리포지토리
  VIDEO_REPOSITORY: Symbol('VideoRepository'),
  CONTENT_REPOSITORY: Symbol('ContentRepository'),
  CHANNEL_REPOSITORY: Symbol('ChannelRepository'),
  HOME_SECTION_REPOSITORY: Symbol('HomeSectionRepository'),
  FAILED_VIDEO_REPOSITORY: Symbol('FailedVideoRepository'),

  // 외부 서비스 (포트)
  YOUTUBE_EXTRACTOR: Symbol('YouTubeExtractor'),
  CONTENT_SEARCH: Symbol('ContentSearch'),
  AI_ANALYZER: Symbol('AIAnalyzer'),
  RSS_FEED: Symbol('RSSFeed'),
  SLACK_NOTIFIER: Symbol('SlackNotifier'),
  HOME_SECTION_GENERATOR: Symbol('HomeSectionGenerator'),
  WEB_SEARCH: Symbol('WebSearch'),
  EXPO_PUSH_SERVICE: Symbol('ExpoPushService'),
  PUSH_REPOSITORY: Symbol('PushRepository'),
} as const;

export type InjectionTokens = typeof INJECTION_TOKENS;
