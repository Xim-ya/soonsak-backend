import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RegisterVideoUseCase } from '../src/application/use-cases/register-video/register-video.use-case';

const VIDEO_ID = process.argv[2];
if (!VIDEO_ID) { console.error('Usage: ts-node scripts/reregister-single.ts <videoId>'); process.exit(1); }

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  const useCase = app.get(RegisterVideoUseCase);
  console.log('\nProcessing: ' + VIDEO_ID);
  const result = await useCase.execute({
    videoId: VIDEO_ID, title: '', description: '',
    publishedAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    channelId: 'unknown', channelName: 'unknown', thumbnail: '',
  });
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
