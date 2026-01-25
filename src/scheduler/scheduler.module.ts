import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ChannelModule } from '@/channel';
import { VideoProcessorModule } from '@/video-processor';
import { SchedulerService } from './services';
import { SchedulerController } from './controllers';

/**
 * Scheduler module - handles cron jobs and batch processing
 */
@Module({
  imports: [ScheduleModule.forRoot(), ChannelModule, VideoProcessorModule],
  providers: [SchedulerService],
  controllers: [SchedulerController],
  exports: [SchedulerService],
})
export class SchedulerModule {}
