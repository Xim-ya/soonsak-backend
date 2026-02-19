/**
 * TMDB API를 사용하여 contents 테이블의 title_logo, title_logo_lang 컬럼 백필
 *
 * 실행 방법:
 * npx ts-node -r tsconfig-paths/register scripts/backfill-title-logo.ts
 *
 * 옵션:
 * --limit=100  : 처리할 최대 콘텐츠 수 (기본값: 전체)
 * --offset=0   : 시작 오프셋 (기본값: 0)
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
  title_logo: string | null;
}

function parseArgs(): { limit?: number; offset: number } {
  const args = process.argv.slice(2);
  let limit: number | undefined;
  let offset = 0;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--offset=')) {
      offset = parseInt(arg.split('=')[1], 10);
    }
  }

  return { limit, offset };
}

async function bootstrap() {
  const { limit, offset } = parseArgs();

  console.log('Starting title logo backfill from TMDB...');
  console.log(`Options: limit=${limit || 'all'}, offset=${offset}\n`);

  const app = await NestFactory.createApplicationContext(AppModule);

  const tmdbAdapter = app.get<IContentSearchPort>(INJECTION_TOKENS.CONTENT_SEARCH);
  const supabaseProvider = app.get(SupabaseClientProvider);
  const supabase = supabaseProvider.getClient();

  // title_logo가 없는 콘텐츠만 조회
  let query = supabase
    .from(SUPABASE_TABLES.CONTENTS)
    .select('id, content_type, title, title_logo')
    .is('title_logo', null)
    .order('id')
    .range(offset, offset + (limit || 10000) - 1);

  const { data: contents, error: fetchError } = await query;

  if (fetchError || !contents) {
    console.error('Failed to fetch contents:', fetchError?.message);
    await app.close();
    return;
  }

  console.log(`Found ${contents.length} contents without title_logo\n`);

  if (contents.length === 0) {
    console.log('All contents already have title_logo. Nothing to update.');
    await app.close();
    return;
  }

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const content of contents as ContentRecord[]) {
    try {
      const progress = successCount + errorCount + skippedCount + 1;
      console.log(
        `[${progress}/${contents.length}] Fetching: ${content.title} (${content.content_type}, ID: ${content.id})`,
      );

      const logoResult = await tmdbAdapter.getTitleLogo(content.id, content.content_type);

      if (!logoResult.path) {
        console.log(`  Skipped: No logo available from TMDB`);
        skippedCount++;
        continue;
      }

      const { error: updateError } = await supabase
        .from(SUPABASE_TABLES.CONTENTS)
        .update({
          title_logo: logoResult.path,
          title_logo_lang: logoResult.lang,
        })
        .eq('id', content.id)
        .eq('content_type', content.content_type);

      if (updateError) {
        console.error(`  Update failed: ${updateError.message}`);
        errorCount++;
      } else {
        console.log(`  Updated: ${logoResult.path} (lang: ${logoResult.lang || 'null'})`);
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
  console.log(`Skipped (no logo): ${skippedCount}`);
  console.log(`Failed: ${errorCount}`);
  console.log('========================================\n');

  await app.close();
}

bootstrap().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
