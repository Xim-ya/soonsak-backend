import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MESSAGES } from '@/shared/constants';

/**
 * Supabase 클라이언트 제공자
 * 단일 인스턴스로 모든 레포지토리에서 공유
 */
@Injectable()
export class SupabaseClientProvider implements OnModuleInit {
  private readonly logger = new Logger(SupabaseClientProvider.name);
  private client: SupabaseClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('SUPABASE_URL');
    const key = this.configService.get<string>('SUPABASE_SERVICE_KEY');

    if (url && key) {
      this.client = createClient(url, key, {
        db: { schema: 'public' },
      });
      this.logger.log('SupabaseClientProvider initialized');
    } else {
      this.logger.warn('SUPABASE_URL or SUPABASE_SERVICE_KEY not configured');
    }
  }

  getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error(MESSAGES.CLIENT.SUPABASE_NOT_INITIALIZED);
    }
    return this.client;
  }

  isInitialized(): boolean {
    return this.client !== null;
  }
}
