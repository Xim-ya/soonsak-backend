/**
 * 홈 섹션 수동 생성 스크립트
 *
 * 실행 방법:
 * npx ts-node -r tsconfig-paths/register scripts/generate-home-sections.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { GenerateHomeSectionsUseCase } from '../src/application/use-cases';

async function bootstrap() {
  console.log('Starting home section generation...\n');

  const app = await NestFactory.createApplicationContext(AppModule);

  const generateHomeSectionsUseCase = app.get(GenerateHomeSectionsUseCase);

  try {
    const result = await generateHomeSectionsUseCase.execute({
      sectionCount: 5,
      itemsPerSection: 10,
      forceRegenerate: true,
    });

    console.log('\n========================================');
    console.log(`Success: ${result.success}`);
    console.log(`Message: ${result.message}`);
    console.log(`Sections created: ${result.sectionCount}`);
    console.log(`Section IDs: ${result.sectionIds.join(', ')}`);
    console.log(`Generated at: ${result.generatedAt.toISOString()}`);
    console.log('========================================\n');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
  }

  await app.close();
}

bootstrap().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
