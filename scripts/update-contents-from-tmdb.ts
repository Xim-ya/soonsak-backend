/**
 * TMDB API를 사용하여 contents 테이블의 상세 정보 업데이트
 *
 * 실행 방법:
 * npm run script:update-contents
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IContentSearchPort } from '../src/application/ports';
import { SupabaseClientProvider } from '../src/infrastructure/persistence/supabase/supabase-client.provider';
import { SUPABASE_TABLES } from '../src/infrastructure/persistence/supabase/supabase-tables';
import { INJECTION_TOKENS } from '../src/shared/constants';
import { ContentTypeValue } from '../src/domain/value-objects';

interface ContentRecord {
  id: number;
  content_type: ContentTypeValue;
  title: string;
}

async function bootstrap() {
  console.log('Starting contents update from TMDB...\n');

  const app = await NestFactory.createApplicationContext(AppModule);

  const tmdbAdapter = app.get<IContentSearchPort>(INJECTION_TOKENS.CONTENT_SEARCH);
  const supabaseProvider = app.get(SupabaseClientProvider);
  const supabase = supabaseProvider.getClient();

  // 모든 contents 조회
  const { data: contents, error: fetchError } = await supabase
    .from(SUPABASE_TABLES.CONTENTS)
    .select('id, content_type, title')
    .order('id');

  if (fetchError || !contents) {
    console.error('Failed to fetch contents:', fetchError?.message);
    await app.close();
    return;
  }

  console.log(`Found ${contents.length} contents to update\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const content of contents as ContentRecord[]) {
    try {
      console.log(`Fetching details for: ${content.title} (${content.content_type}, ID: ${content.id})`);

      const details = await tmdbAdapter.getDetails(content.id, content.content_type);

      const { error: updateError } = await supabase
        .from(SUPABASE_TABLES.CONTENTS)
        .update({
          tagline: details.tagline || null,
          backdrop_path: details.backdropPath || null,
          release_date: details.releaseDate || null,
          genre_ids: details.genreIds || null,
        })
        .eq('id', content.id)
        .eq('content_type', content.content_type);

      if (updateError) {
        console.error(`  Update failed: ${updateError.message}`);
        errorCount++;
      } else {
        const taglinePreview = details.tagline ? details.tagline.substring(0, 30) : 'N/A';
        console.log(`  Updated: tagline="${taglinePreview}...", release_date=${details.releaseDate}, genres=${details.genreIds?.length || 0}`);
        successCount++;
      }

      // Rate limiting - TMDB API는 초당 약 40개 요청 허용
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`  Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      errorCount++;
    }
  }

  console.log('\n========================================');
  console.log(`Successfully updated: ${successCount}`);
  console.log(`Failed: ${errorCount}`);
  console.log('========================================\n');

  await app.close();
}

bootstrap().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
