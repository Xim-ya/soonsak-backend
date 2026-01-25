import { Global, Module } from '@nestjs/common';

/**
 * Common module - provides shared utilities and types
 * Marked as @Global so utilities are available everywhere
 */
@Global()
@Module({
  providers: [],
  exports: [],
})
export class CommonModule {}
