import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * Database module - provides Supabase client globally
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
