import { Module } from '@nestjs/common';
import { TMDBService } from './services';

/**
 * TMDB module - provides movie and TV show search and matching
 */
@Module({
  providers: [TMDBService],
  exports: [TMDBService],
})
export class TMDBModule {}
