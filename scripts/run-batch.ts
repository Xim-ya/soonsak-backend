/**
 * 배치 작업 로컬 1회 실행 스크립트
 *
 * 서버(클라우드)의 SchedulerCron 대신, 맥 가정용 IP에서 youtubei.js 호출을
 * 내보내 YouTube rate limit을 우회하기 위한 standalone 러너.
 * 같은 prod Supabase에 직접 기록한다.
 *
 * 실행:
 *   npx ts-node -r tsconfig-paths/register scripts/run-batch.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { BatchProcessingService } from '../src/application/services';

async function main() {
  const startedAt = new Date();
  console.log(`[run-batch] start ${startedAt.toISOString()}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const batch = app.get(BatchProcessingService);
    const result = await batch.runBatch();

    console.log('\n===== BATCH RESULT =====');
    console.log(`channels:          ${result.totalChannels}`);
    console.log(`videos processed:  ${result.totalVideosProcessed}`);
    console.log(`success:           ${result.totalSuccess}`);
    console.log(`failed:            ${result.totalFailed}`);
    console.log(`skipped shorts:    ${result.totalSkippedShorts}`);
    console.log(`skipped perm-fail: ${result.totalSkippedPermanentlyFailed}`);
    console.log(`duration:          ${Math.round((result.completedAt.getTime() - result.startedAt.getTime()) / 1000)}s`);
    console.log('========================');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('[run-batch] fatal:', e);
  process.exit(1);
});
