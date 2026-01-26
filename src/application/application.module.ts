import { Module } from '@nestjs/common';
import { DomainModule } from '@/domain/domain.module';
import { InfrastructureModule } from '@/infrastructure/infrastructure.module';
import { ProcessVideoUseCase, ProcessChannelUseCase } from './use-cases';
import { BatchProcessingService } from './services';

/**
 * 애플리케이션 모듈
 * Use Cases 및 애플리케이션 서비스 제공
 */
@Module({
  imports: [DomainModule, InfrastructureModule],
  providers: [
    ProcessVideoUseCase,
    ProcessChannelUseCase,
    BatchProcessingService,
  ],
  exports: [
    ProcessVideoUseCase,
    ProcessChannelUseCase,
    BatchProcessingService,
  ],
})
export class ApplicationModule {}
