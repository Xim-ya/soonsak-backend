import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApplicationModule } from '@/application/application.module';
import {
  VideosController,
  ChannelsController,
  BatchController,
  HomeController,
  PushController,
} from './http/controllers';
import { SchedulerCron, HomeSectionCron, PushCron } from './cron';

/**
 * 프레젠테이션 모듈
 * 컨트롤러 및 Cron 작업 제공
 */
@Module({
  imports: [ConfigModule, ApplicationModule],
  controllers: [VideosController, ChannelsController, BatchController, HomeController, PushController],
  providers: [SchedulerCron, HomeSectionCron, PushCron],
  exports: [HomeSectionCron, PushCron],
})
export class PresentationModule {}
