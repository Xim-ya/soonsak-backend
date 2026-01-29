/**
 * TMDB API를 사용하여 contents 테이블의 overview 컬럼 백필
 *
 * 실행 방법:
 * npx ts-node -r tsconfig-paths/register scripts/backfill-overview.ts
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
  overview: string | null;
}

async function bootstrap() {
  console.log('Starting overview backfill from TMDB...\n');

  const app = await NestFactory.createApplicationContext(AppModule);

  const tmdbAdapter = app.get<IContentSearchPort>(INJECTION_TOKENS.CONTENT_SEARCH);
  const supabaseProvider = app.get(SupabaseClientProvider);
  const supabase = supabaseProvider.getClient();

  // overview가 없는 콘텐츠만 조회
  const { data: contents, error: fetchError } = await supabase
    .from(SUPABASE_TABLES.CONTENTS)
    .select('id, content_type, title, overview')
    .is('overview', null)
    .order('id');

  if (fetchError || !contents) {
    console.error('Failed to fetch contents:', fetchError?.message);
    await app.close();
    return;
  }

  console.log(`Found ${contents.length} contents without overview\n`);

  if (contents.length === 0) {
    console.log('All contents already have overview. Nothing to update.');
    await app.close();
    return;
  }

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const content of contents as ContentRecord[]) {
    try {
      console.log(
        `[${successCount + errorCount + skippedCount + 1}/${contents.length}] Fetching: ${content.title} (${content.content_type}, ID: ${content.id})`,
      );

      const details = await tmdbAdapter.getDetails(content.id, content.content_type);

      if (!details.overview) {
        console.log(`  Skipped: No overview available from TMDB`);
        skippedCount++;
        continue;
      }

      const { error: updateError } = await supabase
        .from(SUPABASE_TABLES.CONTENTS)
        .update({ overview: details.overview })
        .eq('id', content.id)
        .eq('content_type', content.content_type);

      if (updateError) {
        console.error(`  Update failed: ${updateError.message}`);
        errorCount++;
      } else {
        const overviewPreview = details.overview.substring(0, 50);
        console.log(`  Updated: "${overviewPreview}..."`);
        successCount++;
      }

      // Rate limiting - TMDB API는 초당 약 40개 요청 허용
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      console.error(
        `  Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      errorCount++;
    }
  }

  console.log('\n========================================');
  console.log(`Successfully updated: ${successCount}`);
  console.log(`Skipped (no overview): ${skippedCount}`);
  console.log(`Failed: ${errorCount}`);
  console.log('========================================\n');

  await app.close();
}

bootstrap().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
