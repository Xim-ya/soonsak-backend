import { Module } from '@nestjs/common';
import { YouTubeExtractorService, YouTubeRSSService, YouTubeScriptService } from './services';

/**
 * YouTube module - provides video extraction, RSS parsing, and script analysis
 */
@Module({
  providers: [YouTubeExtractorService, YouTubeRSSService, YouTubeScriptService],
  exports: [YouTubeExtractorService, YouTubeRSSService, YouTubeScriptService],
})
export class YouTubeModule {}
