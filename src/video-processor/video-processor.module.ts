import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database';
import { YouTubeModule } from '@/youtube';
import { TMDBModule } from '@/tmdb';
import { VideoProcessorService } from './services';

/**
 * Video Processor module - orchestrates video processing pipeline
 */
@Module({
  imports: [DatabaseModule, YouTubeModule, TMDBModule],
  providers: [VideoProcessorService],
  exports: [VideoProcessorService],
})
export class VideoProcessorModule {}
