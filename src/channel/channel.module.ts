import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database';
import { YouTubeModule } from '@/youtube';
import { ChannelService } from './services';

/**
 * Channel module - manages channel data and RSS operations
 */
@Module({
  imports: [DatabaseModule, YouTubeModule],
  providers: [ChannelService],
  exports: [ChannelService],
})
export class ChannelModule {}
