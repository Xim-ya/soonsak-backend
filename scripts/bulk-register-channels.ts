/**
 * 채널 및 영상 일괄 등록 스크립트
 *
 * 실행 방법:
 * npx ts-node -r tsconfig-paths/register scripts/bulk-register-channels.ts
 *
 * 옵션:
 * --max=50  : 채널당 최대 영상 수 (기본값: 100)
 * --channel=@handle : 특정 채널만 처리
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RegisterChannelVideosUseCase } from '../src/application/use-cases';
import * as fs from 'fs';
import * as path from 'path';

interface ChannelList {
  channels: string[];
}

interface RegistrationSummary {
  channelId: string;
  channelName: string;
  totalVideos: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  skippedShortsCount: number;
  errors: string[];
}

/** 딜레이 헬퍼 */
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** URL에서 채널 핸들 추출 */
function extractChannelHandle(url: string): string {
  // https://www.youtube.com/@handle 형식에서 @handle 추출
  const match = url.match(/@([^/]+)/);
  if (match) {
    return `@${decodeURIComponent(match[1])}`;
  }
  // 이미 @handle 형식이면 그대로 반환
  if (url.startsWith('@')) {
    return url;
  }
  // UC... 형식이면 그대로 반환
  return url;
}

async function bootstrap() {
  // 인자 파싱
  const args = process.argv.slice(2);
  let maxVideos = 100;
  let specificChannel: string | null = null;

  for (const arg of args) {
    if (arg.startsWith('--max=')) {
      maxVideos = parseInt(arg.split('=')[1], 10);
    }
    if (arg.startsWith('--channel=')) {
      specificChannel = arg.split('=')[1];
    }
  }

  console.log('========================================');
  console.log('채널 및 영상 일괄 등록 스크립트');
  console.log('========================================');
  console.log(`최대 영상 수: ${maxVideos}`);
  if (specificChannel) {
    console.log(`특정 채널: ${specificChannel}`);
  }
  console.log('');

  // 채널 리스트 로드
  const channelListPath = path.join(__dirname, '../assets/channel_list.json');
  if (!fs.existsSync(channelListPath)) {
    console.error('채널 리스트 파일을 찾을 수 없습니다:', channelListPath);
    process.exit(1);
  }

  const channelList: ChannelList = JSON.parse(fs.readFileSync(channelListPath, 'utf-8'));
  let channels = channelList.channels.map(extractChannelHandle);

  if (specificChannel) {
    channels = channels.filter(c => c.includes(specificChannel));
    if (channels.length === 0) {
      console.error(`채널을 찾을 수 없습니다: ${specificChannel}`);
      process.exit(1);
    }
  }

  console.log(`처리할 채널 수: ${channels.length}`);
  console.log('채널 목록:', channels.join(', '));
  console.log('');

  // NestJS 앱 컨텍스트 생성
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const registerChannelVideosUseCase = app.get(RegisterChannelVideosUseCase);
  const summaries: RegistrationSummary[] = [];

  // 각 채널 처리
  for (let i = 0; i < channels.length; i++) {
    const channelHandle = channels[i];
    console.log('========================================');
    console.log(`[${i + 1}/${channels.length}] 처리 중: ${channelHandle}`);
    console.log('========================================');

    try {
      const result = await registerChannelVideosUseCase.execute({
        channelId: channelHandle,
        maxVideos,
      });

      summaries.push({
        channelId: result.channelId,
        channelName: result.channelName,
        totalVideos: result.totalVideos,
        successCount: result.successCount,
        failedCount: result.failedCount,
        skippedCount: result.skippedCount,
        skippedShortsCount: result.skippedShortsCount,
        errors: result.errors,
      });

      console.log(`완료: ${result.channelName}`);
      console.log(`  - 전체: ${result.totalVideos}, 성공: ${result.successCount}, 실패: ${result.failedCount}`);
      console.log(`  - 스킵: ${result.skippedCount}, 쇼츠: ${result.skippedShortsCount}`);
      if (result.errors.length > 0) {
        console.log(`  - 에러: ${result.errors.slice(0, 3).join(', ')}${result.errors.length > 3 ? '...' : ''}`);
      }
    } catch (error) {
      console.error(`채널 처리 실패: ${(error as Error).message}`);
      summaries.push({
        channelId: channelHandle,
        channelName: 'ERROR',
        totalVideos: 0,
        successCount: 0,
        failedCount: 0,
        skippedCount: 0,
        skippedShortsCount: 0,
        errors: [(error as Error).message],
      });
    }

    // 채널 간 딜레이 (레이트 리미팅 방지)
    if (i < channels.length - 1) {
      console.log('다음 채널까지 5초 대기...');
      await delay(5000);
    }
  }

  // 최종 요약
  console.log('\n');
  console.log('========================================');
  console.log('최종 요약');
  console.log('========================================');

  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalShorts = 0;

  for (const summary of summaries) {
    console.log(`${summary.channelName} (${summary.channelId}):`);
    console.log(`  성공: ${summary.successCount}, 실패: ${summary.failedCount}, 스킵: ${summary.skippedCount}, 쇼츠: ${summary.skippedShortsCount}`);

    totalSuccess += summary.successCount;
    totalFailed += summary.failedCount;
    totalSkipped += summary.skippedCount;
    totalShorts += summary.skippedShortsCount;
  }

  console.log('----------------------------------------');
  console.log(`총 성공: ${totalSuccess}`);
  console.log(`총 실패: ${totalFailed}`);
  console.log(`총 스킵: ${totalSkipped}`);
  console.log(`총 쇼츠 스킵: ${totalShorts}`);
  console.log('========================================');

  await app.close();
}

bootstrap().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
