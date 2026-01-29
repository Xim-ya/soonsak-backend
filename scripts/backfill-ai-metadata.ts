/**
 * TMDB API를 사용하여 AI 분석용 메타데이터 백필
 * - vote_average, popularity, origin_country, directors, main_cast
 *
 * 실행 방법:
 * npx ts-node -r tsconfig-paths/register scripts/backfill-ai-metadata.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IContentSearchPort } from '../src/application/ports';
import { SupabaseClientProvider } from '../src/infrastructure/persistence/supabase/supabase-client.provider';
import { SUPABASE_TABLES } from '../src/infrastructure/persistence/supabase/supabase-tables';
import { INJECTION_TOKENS } from '../src/shared/constants';
import { ContentTypeValue } from '../src/domain/value-objects';

interface PersonInfo {
  id: number;
  name: string;
}

interface ContentRecord {
  id: number;
  content_type: ContentTypeValue;
  title: string;
  vote_average: number | null;
  popularity: number | null;
  origin_country: string[] | null;
  directors: PersonInfo[] | null;
  main_cast: PersonInfo[] | null;
}

async function bootstrap() {
  console.log('Starting AI metadata backfill from TMDB...\n');

  const app = await NestFactory.createApplicationContext(AppModule);

  const tmdbAdapter = app.get<IContentSearchPort>(INJECTION_TOKENS.CONTENT_SEARCH);
  const supabaseProvider = app.get(SupabaseClientProvider);
  const supabase = supabaseProvider.getClient();

  // AI 메타데이터가 없는 콘텐츠 조회
  const { data: contents, error: fetchError } = await supabase
    .from(SUPABASE_TABLES.CONTENTS)
    .select('id, content_type, title, vote_average, popularity, origin_country, directors, main_cast')
    .or('vote_average.is.null,directors.is.null')
    .order('id');

  if (fetchError || !contents) {
    console.error('Failed to fetch contents:', fetchError?.message);
    await app.close();
    return;
  }

  console.log(`Found ${contents.length} contents to update\n`);

  if (contents.length === 0) {
    console.log('All contents already have AI metadata. Nothing to update.');
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

      const updateData: Record<string, unknown> = {};

      if (details.voteAverage !== undefined) {
        updateData.vote_average = details.voteAverage;
      }
      if (details.popularity !== undefined) {
        updateData.popularity = details.popularity;
      }
      if (details.originCountry && details.originCountry.length > 0) {
        updateData.origin_country = details.originCountry;
      }
      if (details.directors && details.directors.length > 0) {
        updateData.directors = details.directors;
      }
      if (details.mainCast && details.mainCast.length > 0) {
        updateData.main_cast = details.mainCast;
      }

      if (Object.keys(updateData).length === 0) {
        console.log(`  Skipped: No additional data available from TMDB`);
        skippedCount++;
        continue;
      }

      const { error: updateError } = await supabase
        .from(SUPABASE_TABLES.CONTENTS)
        .update(updateData)
        .eq('id', content.id)
        .eq('content_type', content.content_type);

      if (updateError) {
        console.error(`  Update failed: ${updateError.message}`);
        errorCount++;
      } else {
        const info: string[] = [];
        if (updateData.vote_average) info.push(`rating:${updateData.vote_average}`);
        if (updateData.directors) {
          const directorNames = (updateData.directors as PersonInfo[]).map((d) => d.name).join(', ');
          info.push(`directors:${directorNames}`);
        }
        if (updateData.main_cast) {
          const castNames = (updateData.main_cast as PersonInfo[]).slice(0, 2).map((c) => c.name).join(', ');
          info.push(`cast:${castNames}...`);
        }
        console.log(`  Updated: ${info.join(' | ')}`);
        successCount++;
      }

      // Rate limiting - TMDB API 초당 약 40개 요청 허용
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
  console.log(`Skipped (no data): ${skippedCount}`);
  console.log(`Failed: ${errorCount}`);
  console.log('========================================\n');

  await app.close();
}

bootstrap().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
