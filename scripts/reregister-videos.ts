import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RegisterVideoUseCase } from '../src/application/use-cases/register-video/register-video.use-case';

const VIDEO_IDS = [
  'wQ2SVs1mfp0',
  'oJkdPB1o6qU',
  '1eb61GVhXHE',
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  const useCase = app.get(RegisterVideoUseCase);

  const results: Array<{ videoId: string; success: boolean; tmdbTitle?: string; tmdbId?: number; message?: string }> = [];

  for (const videoId of VIDEO_IDS) {
    console.log('\n' + '='.repeat(60));
    console.log('Processing: ' + videoId);
    console.log('='.repeat(60));

    try {
      const result = await useCase.execute({
        videoId,
        title: '',
        description: '',
        publishedAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        channelId: 'unknown',
        channelName: 'unknown',
        thumbnail: '',
      });

      results.push({
        videoId,
        success: result.success,
        tmdbTitle: result.data?.tmdbTitle,
        tmdbId: result.data?.tmdbId,
        message: result.message,
      });

      // Rate limiting
      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      results.push({ videoId, success: false, message: (error as Error).message });
    }
  }

  console.log('\n\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  let matched = 0;
  let failed = 0;
  for (const r of results) {
    const status = r.success ? 'OK' : 'FAIL';
    const info = r.tmdbTitle ? '-> ' + r.tmdbTitle + ' (id=' + r.tmdbId + ')' : (r.message || '');
    console.log(status + ' ' + r.videoId + ' ' + info);
    if (r.success) matched++;
    else failed++;
  }

  console.log('\nTotal: ' + results.length + ', Matched: ' + matched + ', Failed: ' + failed);
  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
