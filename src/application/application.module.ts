import { Module } from '@nestjs/common';
import { DomainModule } from '@/domain/domain.module';
import { InfrastructureModule } from '@/infrastructure/infrastructure.module';
import {
  RegisterVideoUseCase,
  RegisterChannelUseCase,
  RegisterChannelVideosUseCase,
  GenerateHomeSectionsUseCase,
} from './use-cases';
import { BatchProcessingService } from './services';

/**
 * 애플리케이션 모듈
 * Use Cases 및 애플리케이션 서비스 제공
 */
@Module({
  imports: [DomainModule, InfrastructureModule],
  providers: [
    RegisterVideoUseCase,
    RegisterChannelUseCase,
    RegisterChannelVideosUseCase,
    GenerateHomeSectionsUseCase,
    BatchProcessingService,
  ],
  exports: [
    RegisterVideoUseCase,
    RegisterChannelUseCase,
    RegisterChannelVideosUseCase,
    GenerateHomeSectionsUseCase,
    BatchProcessingService,
  ],
})
export class ApplicationModule {}
