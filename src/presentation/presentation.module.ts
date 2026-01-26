import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApplicationModule } from '@/application/application.module';
import { SchedulerController } from './http/controllers';
import { SchedulerCron } from './cron';

/**
 * 프레젠테이션 모듈
 * 컨트롤러 및 Cron 작업 제공
 */
@Module({
  imports: [ConfigModule, ApplicationModule],
  controllers: [SchedulerController],
  providers: [SchedulerCron],
})
export class PresentationModule {}
