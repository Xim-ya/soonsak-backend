import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { INJECTION_TOKENS } from '@/shared/constants';
import { SupabaseClientProvider } from './persistence/supabase/supabase-client.provider';
import {
  SupabaseVideoRepository,
  SupabaseContentRepository,
  SupabaseChannelRepository,
  SupabaseHomeSectionRepository,
  SupabaseFailedVideoRepository,
} from './persistence/supabase/repositories';
import { YouTubeExtractorAdapter, RSSFeedAdapter } from './external-services/youtube/adapters';
import { TMDBAdapter } from './external-services/tmdb/tmdb.adapter';
import { OpenAIAdapter, OpenAIHomeSectionAdapter } from './external-services/openai';
import { SlackNotificationAdapter } from './external-services/slack';

/**
 * 인프라스트럭처 모듈
 * 리포지토리 및 외부 서비스 어댑터 제공
 */
@Module({
  imports: [ConfigModule],
  providers: [
    // Supabase Client Provider
    SupabaseClientProvider,
    // Repositories
    {
      provide: INJECTION_TOKENS.VIDEO_REPOSITORY,
      useClass: SupabaseVideoRepository,
    },
    {
      provide: INJECTION_TOKENS.CONTENT_REPOSITORY,
      useClass: SupabaseContentRepository,
    },
    {
      provide: INJECTION_TOKENS.CHANNEL_REPOSITORY,
      useClass: SupabaseChannelRepository,
    },
    {
      provide: INJECTION_TOKENS.HOME_SECTION_REPOSITORY,
      useClass: SupabaseHomeSectionRepository,
    },
    {
      provide: INJECTION_TOKENS.FAILED_VIDEO_REPOSITORY,
      useClass: SupabaseFailedVideoRepository,
    },
    // External Services
    {
      provide: INJECTION_TOKENS.YOUTUBE_EXTRACTOR,
      useClass: YouTubeExtractorAdapter,
    },
    {
      provide: INJECTION_TOKENS.RSS_FEED,
      useClass: RSSFeedAdapter,
    },
    {
      provide: INJECTION_TOKENS.CONTENT_SEARCH,
      useClass: TMDBAdapter,
    },
    {
      provide: INJECTION_TOKENS.AI_ANALYZER,
      useClass: OpenAIAdapter,
    },
    {
      provide: INJECTION_TOKENS.SLACK_NOTIFIER,
      useClass: SlackNotificationAdapter,
    },
    {
      provide: INJECTION_TOKENS.HOME_SECTION_GENERATOR,
      useClass: OpenAIHomeSectionAdapter,
    },
  ],
  exports: [
    SupabaseClientProvider,
    INJECTION_TOKENS.VIDEO_REPOSITORY,
    INJECTION_TOKENS.CONTENT_REPOSITORY,
    INJECTION_TOKENS.CHANNEL_REPOSITORY,
    INJECTION_TOKENS.HOME_SECTION_REPOSITORY,
    INJECTION_TOKENS.FAILED_VIDEO_REPOSITORY,
    INJECTION_TOKENS.YOUTUBE_EXTRACTOR,
    INJECTION_TOKENS.RSS_FEED,
    INJECTION_TOKENS.CONTENT_SEARCH,
    INJECTION_TOKENS.AI_ANALYZER,
    INJECTION_TOKENS.SLACK_NOTIFIER,
    INJECTION_TOKENS.HOME_SECTION_GENERATOR,
  ],
})
export class InfrastructureModule {}
