import { Module } from '@nestjs/common';
import { LLMService } from './services';

/**
 * AI module - provides LLM-based content extraction and analysis
 */
@Module({
  providers: [LLMService],
  exports: [LLMService],
})
export class AIModule {}
