/**
 * TMDB 매핑 정확도 검증 스크립트
 *
 * confirmed 비디오를 현재 프롬프트로 재분석하여 mismatch 케이스를 식별합니다.
 *
 * 사용법: npx ts-node scripts/validate-mapping-accuracy.ts [limit]
 * 예시: npx ts-node scripts/validate-mapping-accuracy.ts 50
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SupabaseClientProvider } from '../src/infrastructure/persistence/supabase/supabase-client.provider';
import { IAIAnalyzerPort, IContentSearchPort } from '../src/application/ports';
import { INJECTION_TOKENS } from '../src/shared/constants';

interface VideoData {
  video_id: string;
  video_title: string;
  content_id: number;
  content_type: 'movie' | 'tv';
  content_title: string;
  channel_name: string;
}

interface ValidationResult {
  video_id: string;
  video_title: string;
  original_content: { id: number; type: string; title: string };
  ai_result: {
    extracted_titles: string[];
    inferred_titles: string[];
    confidence: number;
    selected_tmdb?: { tmdb_id: number; type: string; confidence: number };
  } | null;
  match_status: 'MATCH' | 'MISMATCH' | 'NO_EXTRACTION' | 'ERROR';
  mismatch_reason?: string;
}

async function main() {
  const limit = parseInt(process.argv[2]) || 50;
  console.log(`\n🔍 TMDB 매핑 정확도 검증 시작 (${limit}개 비디오)\n`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error']
  });

  const supabaseProvider = app.get(SupabaseClientProvider);
  const supabase = supabaseProvider.getClient();
  const aiAnalyzer = app.get<IAIAnalyzerPort>(INJECTION_TOKENS.AI_ANALYZER);
  const contentSearch = app.get<IContentSearchPort>(INJECTION_TOKENS.CONTENT_SEARCH);

  // 1. confirmed 비디오 가져오기
  console.log('📥 Confirmed 비디오 로딩...');
  const { data: videos, error } = await supabase
    .from('videos')
    .select(`
      id,
      title,
      content_id,
      content_type,
      contents!inner(title)
    `)
    .eq('status', 'confirmed')
    .not('content_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error || !videos) {
    console.error('❌ 비디오 로딩 실패:', error);
    await app.close();
    return;
  }

  const videoList: VideoData[] = videos.map((v: any) => ({
    video_id: v.id,
    video_title: v.title,
    content_id: v.content_id,
    content_type: v.content_type,
    content_title: v.contents?.title || 'Unknown',
    channel_name: '',
  }));

  console.log(`✅ ${videoList.length}개 비디오 로딩 완료\n`);

  // 2. 각 비디오 재분석
  const results: ValidationResult[] = [];
  let matchCount = 0;
  let mismatchCount = 0;
  let noExtractionCount = 0;
  let errorCount = 0;

  for (let i = 0; i < videoList.length; i++) {
    const video = videoList[i];
    console.log(`[${i + 1}/${videoList.length}] ${video.video_title.substring(0, 50)}...`);

    try {
      // Phase 1: Direct Extraction
      const phase1Result = await aiAnalyzer.extractDirectMention({
        videoId: video.video_id,
        videoTitle: video.video_title,
        videoDescription: '',
        videoDuration: 600,
      });

      let matchStatus: ValidationResult['match_status'] = 'NO_EXTRACTION';
      let mismatchReason: string | undefined;
      let aiResult: ValidationResult['ai_result'] = null;

      if (phase1Result.extractedTitle && phase1Result.confidence >= 80) {
        // Phase 1 성공 - 제목 직접 추출됨
        aiResult = {
          extracted_titles: [phase1Result.extractedTitle],
          inferred_titles: [],
          confidence: phase1Result.confidence,
        };

        // 제목 비교 (Fuzzy Matching 적용)
        const titleMatch = isTitleMatch(phase1Result.extractedTitle, video.content_title);

        if (titleMatch.match) {
          matchStatus = 'MATCH';
          matchCount++;
          if (titleMatch.reason !== '완전일치') {
            console.log(`   📝 ${titleMatch.reason}: "${phase1Result.extractedTitle}" ↔ "${video.content_title}"`);
          }
        } else {
          matchStatus = 'MISMATCH';
          mismatchCount++;
          mismatchReason = `추출된 제목 "${phase1Result.extractedTitle}" ≠ 원본 "${video.content_title}" (${titleMatch.reason})`;
        }
      } else {
        // Phase 1 실패 or 낮은 confidence - Phase 2 시도
        const searchTitle = phase1Result.extractedTitle || video.video_title;
        const candidates = await contentSearch.searchMulti(searchTitle);

        if (candidates.length > 0) {
          const phase2Result = await aiAnalyzer.analyzeVideoContent({
            videoId: video.video_id,
            videoDuration: 600,
            tmdbCandidates: candidates.slice(0, 5),
          });

          aiResult = {
            extracted_titles: phase2Result.extractedTitles || [],
            inferred_titles: phase2Result.inferredTitles || [],
            confidence: phase2Result.confidence,
            selected_tmdb: phase2Result.selectedTMDBMatch ? {
              tmdb_id: phase2Result.selectedTMDBMatch.tmdbId,
              type: phase2Result.selectedTMDBMatch.type,
              confidence: phase2Result.selectedTMDBMatch.confidence,
            } : undefined,
          };

          if (phase2Result.selectedTMDBMatch) {
            if (phase2Result.selectedTMDBMatch.tmdbId === video.content_id &&
                phase2Result.selectedTMDBMatch.type === video.content_type) {
              matchStatus = 'MATCH';
              matchCount++;
            } else {
              matchStatus = 'MISMATCH';
              mismatchCount++;
              mismatchReason = `AI 선택 TMDB ID ${phase2Result.selectedTMDBMatch.tmdbId} ≠ 원본 ${video.content_id}`;
            }
          } else {
            // TMDB 선택 없음
            const allTitles = [...(phase2Result.extractedTitles || []), ...(phase2Result.inferredTitles || [])];
            if (allTitles.length > 0) {
              // Fuzzy Matching으로 제목 비교
              let bestMatch = { title: '', match: false, similarity: 0, reason: '' };
              for (const t of allTitles) {
                const result = isTitleMatch(t, video.content_title);
                if (result.similarity > bestMatch.similarity) {
                  bestMatch = { title: t, ...result };
                }
              }

              if (bestMatch.match) {
                matchStatus = 'MATCH';
                matchCount++;
                if (bestMatch.reason !== '완전일치') {
                  console.log(`   📝 ${bestMatch.reason}: "${bestMatch.title}" ↔ "${video.content_title}"`);
                }
              } else {
                matchStatus = 'MISMATCH';
                mismatchCount++;
                mismatchReason = `추론된 제목들 [${allTitles.join(', ')}] ≠ 원본 "${video.content_title}" (${bestMatch.reason})`;
              }
            } else {
              matchStatus = 'NO_EXTRACTION';
              noExtractionCount++;
              mismatchReason = `제목 추출 실패 (confidence: ${phase2Result.confidence})`;
            }
          }
        } else {
          matchStatus = 'NO_EXTRACTION';
          noExtractionCount++;
          mismatchReason = 'TMDB 검색 결과 없음';
        }
      }

      results.push({
        video_id: video.video_id,
        video_title: video.video_title,
        original_content: {
          id: video.content_id,
          type: video.content_type,
          title: video.content_title,
        },
        ai_result: aiResult,
        match_status: matchStatus,
        mismatch_reason: mismatchReason,
      });

      // 진행 상태 출력
      const statusIcon = matchStatus === 'MATCH' ? '✅' : matchStatus === 'MISMATCH' ? '❌' : '⚠️';
      console.log(`   ${statusIcon} ${matchStatus} ${mismatchReason ? `- ${mismatchReason.substring(0, 60)}` : ''}`);

      // API 레이트 리밋 방지
      await sleep(500);

    } catch (error) {
      console.log(`   ❌ ERROR: ${(error as Error).message}`);
      errorCount++;
      results.push({
        video_id: video.video_id,
        video_title: video.video_title,
        original_content: {
          id: video.content_id,
          type: video.content_type,
          title: video.content_title,
        },
        ai_result: null,
        match_status: 'ERROR',
        mismatch_reason: (error as Error).message,
      });
    }
  }

  // 3. 결과 요약
  console.log('\n' + '='.repeat(60));
  console.log('📊 검증 결과 요약');
  console.log('='.repeat(60));
  console.log(`총 검증: ${videoList.length}개`);
  console.log(`✅ MATCH: ${matchCount}개 (${(matchCount / videoList.length * 100).toFixed(1)}%)`);
  console.log(`❌ MISMATCH: ${mismatchCount}개 (${(mismatchCount / videoList.length * 100).toFixed(1)}%)`);
  console.log(`⚠️ NO_EXTRACTION: ${noExtractionCount}개 (${(noExtractionCount / videoList.length * 100).toFixed(1)}%)`);
  console.log(`🔴 ERROR: ${errorCount}개 (${(errorCount / videoList.length * 100).toFixed(1)}%)`);

  // 4. Mismatch 케이스 상세
  const mismatches = results.filter(r => r.match_status === 'MISMATCH');
  if (mismatches.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('❌ MISMATCH 케이스 상세');
    console.log('='.repeat(60));
    mismatches.forEach((m, i) => {
      console.log(`\n[${i + 1}] ${m.video_title.substring(0, 60)}`);
      console.log(`    원본: ${m.original_content.title} (${m.original_content.type}, ID: ${m.original_content.id})`);
      console.log(`    AI: ${m.ai_result?.extracted_titles?.join(', ') || m.ai_result?.inferred_titles?.join(', ') || 'N/A'}`);
      console.log(`    사유: ${m.mismatch_reason}`);
    });
  }

  // 5. NO_EXTRACTION 케이스 상세
  const noExtractions = results.filter(r => r.match_status === 'NO_EXTRACTION');
  if (noExtractions.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('⚠️ NO_EXTRACTION 케이스 (제목 추출 실패)');
    console.log('='.repeat(60));
    noExtractions.forEach((m, i) => {
      console.log(`[${i + 1}] ${m.video_title.substring(0, 50)} → ${m.original_content.title}`);
    });
  }

  await app.close();
  console.log('\n✅ 검증 완료\n');
}

/**
 * 한글 음차 정규화: 흔한 음차 변형 통일
 * 예: 크로니클→클로니클, 메트릭스→매트릭스, 레킹→래킹
 */
function normalizeKoreanPhonetics(text: string): string {
  return text
    // 흔한 음차 패턴 (순서 중요)
    .replace(/크로/g, '클로')
    .replace(/메트/g, '매트')
    .replace(/레/g, '래')
    .replace(/웨/g, '워')
    .replace(/쉬/g, '시')
    .replace(/팬/g, '판')
    .replace(/프로/g, '크루');  // Pro/Crew 같은 단어 통일
}

function normalizeTitle(title: string): string {
  let normalized = title
    .toLowerCase()
    .replace(/[:\s\-_.,!?'"()【】《》\[\]]/g, '')
    .replace(/시즌\d+/g, '')
    .replace(/season\d+/gi, '')
    .trim();

  // 한글 음차 정규화 적용
  normalized = normalizeKoreanPhonetics(normalized);
  return normalized;
}

/**
 * Levenshtein 거리 계산
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * 두 문자열의 유사도 계산 (0-1, 1이 완전 일치)
 */
function similarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(str1, str2) / maxLen;
}

/**
 * 핵심 단어 추출 (가장 긴 의미 있는 단어)
 */
function extractCoreWord(title: string): string {
  const words = title.split(/[\s\-_:]/);
  const meaningful = words.filter(w => w.length >= 2 && !['the', 'a', 'an', '더'].includes(w.toLowerCase()));
  if (meaningful.length === 0) return title;
  return meaningful.reduce((a, b) => a.length >= b.length ? a : b);
}

/**
 * 제목 유사도 비교 (음차 변형 허용)
 * - 완전 일치 (정규화 후)
 * - 포함 관계
 * - Levenshtein 유사도 75% 이상
 * - 핵심 단어 유사도 75% 이상
 */
function isTitleMatch(extracted: string, original: string): { match: boolean; similarity: number; reason: string } {
  const extractedNorm = normalizeTitle(extracted);
  const originalNorm = normalizeTitle(original);

  // 1. 완전 일치 (정규화 후)
  if (extractedNorm === originalNorm) {
    return { match: true, similarity: 1.0, reason: '완전일치' };
  }

  // 2. 포함 관계
  if (extractedNorm.includes(originalNorm) || originalNorm.includes(extractedNorm)) {
    return { match: true, similarity: 0.95, reason: '포함관계' };
  }

  // 3. 전체 유사도 (임계값 75%)
  const fullSim = similarity(extractedNorm, originalNorm);
  if (fullSim >= 0.75) {
    return { match: true, similarity: fullSim, reason: `음차유사(${(fullSim * 100).toFixed(0)}%)` };
  }

  // 4. 핵심 단어 비교 (제목이 다르지만 핵심 단어가 유사할 때)
  const extractedCore = normalizeTitle(extractCoreWord(extracted));
  const originalCore = normalizeTitle(extractCoreWord(original));
  const coreSim = similarity(extractedCore, originalCore);

  if (coreSim >= 0.75 && extractedCore.length >= 2 && originalCore.length >= 2) {
    return { match: true, similarity: coreSim, reason: `핵심단어유사(${(coreSim * 100).toFixed(0)}%)` };
  }

  return { match: false, similarity: fullSim, reason: `불일치(${(fullSim * 100).toFixed(0)}%)` };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(e => {
  console.error('스크립트 실행 오류:', e);
  process.exit(1);
});
