import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DomainModule } from '@/domain/domain.module';
import { InfrastructureModule } from '@/infrastructure/infrastructure.module';
import { ApplicationModule } from '@/application/application.module';
import { PresentationModule } from '@/presentation/presentation.module';

/**
 * 애플리케이션 루트 모듈
 * 레이어 기반 아키텍처 구성
 */
@Module({
  imports: [
    // 설정
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),

    // 아키텍처 레이어
    DomainModule,
    InfrastructureModule,
    ApplicationModule,
    PresentationModule,
  ],
})
export class AppModule {}
