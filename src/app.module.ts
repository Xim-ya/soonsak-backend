import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '@/common';
import { DatabaseModule } from '@/database';
import { YouTubeModule } from '@/youtube';
import { TMDBModule } from '@/tmdb';
import { AIModule } from '@/ai';
import { VideoProcessorModule } from '@/video-processor';
import { ChannelModule } from '@/channel';
import { SchedulerModule } from '@/scheduler';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    CommonModule,
    DatabaseModule,
    YouTubeModule,
    TMDBModule,
    AIModule,
    VideoProcessorModule,
    ChannelModule,
    SchedulerModule,
  ],
})
export class AppModule {}
