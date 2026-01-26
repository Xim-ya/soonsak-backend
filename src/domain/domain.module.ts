import { Module } from '@nestjs/common';
import {
  TitleExtractionService,
  EndingDetectionService,
  PrimaryVideoSelectionService,
} from './services';

/**
 * 도메인 모듈
 * 도메인 서비스 제공
 */
@Module({
  providers: [
    TitleExtractionService,
    EndingDetectionService,
    PrimaryVideoSelectionService,
  ],
  exports: [
    TitleExtractionService,
    EndingDetectionService,
    PrimaryVideoSelectionService,
  ],
})
export class DomainModule {}
