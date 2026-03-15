/**
 * Full Accuracy Validation Script
 *
 * confirmed 비디오를 현재 AI 로직으로 재분석하여:
 * 1. TMDB 매핑 정확도
 * 2. includes_ending 판단 정확도
 * 를 측정합니다.
 *
 * 사용법: npx ts-node scripts/validate-full-accuracy.ts [limit]
 * 예시: npx ts-node scripts/validate-full-accuracy.ts 50
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SupabaseClientProvider } from '../src/infrastructure/persistence/supabase/supabase-client.provider';
import { IAIAnalyzerPort, IContentSearchPort } from '../src/application/ports';
import { INJECTION_TOKENS } from '../src/shared/constants';
import * as fs from 'fs';

/**
 * 키워드 기반 결말 판단 (EndingDetectionService와 동일 로직)
 */
function detectEndingFromKeywords(title: string, description?: string): boolean {
  const text = `${title} ${description || ''}`.toLowerCase();

  const explicitKeywords = [
    '결말포함',
    '결말',
    '엔딩',
    '스포일러',
    '스포',
    '최종화',
    '마지막화',
    '완결',
  ];

  const seriesPatterns = [
    /시즌\s*\d+[\s\S]*시즌\s*\d+/,
    /시즌\s*1[\s\S]*뉴\s*블러드/,
    /전편/,
    /총집편/,
    /전체\s*정리/,
    /완전\s*정리/,
    /처음부터\s*끝까지/,
  ];

  // 명시적 키워드 확인
  if (explicitKeywords.some((keyword) => text.includes(keyword))) {
    return true;
  }

  // 시리즈 패턴 확인
  if (seriesPatterns.some((pattern) => pattern.test(text))) {
    return true;
  }

  // 다중 시즌 확인
  const seasonMatches = text.match(/시즌\s*\d+/g);
  if (seasonMatches && seasonMatches.length >= 3) {
    return true;
  }

  return false;
}

interface VideoData {
  video_id: string;
  video_title: string;
  content_id: number;
  content_type: 'movie' | 'tv';
  content_title: string;
  includes_ending: boolean;
  runtime: number;
}

interface ValidationResult {
  video_id: string;
  video_title: string;
  original: {
    content_id: number;
    content_type: string;
    content_title: string;
    includes_ending: boolean;
  };
  predicted: {
    extracted_titles: string[];
    inferred_titles: string[];
    confidence: number;
    includes_ending: boolean;
    selected_tmdb_id?: number;
    selected_tmdb_type?: string;
  };
  mapping_status: 'MATCH' | 'MISMATCH' | 'NO_EXTRACTION' | 'ERROR';
  ending_status: 'CORRECT' | 'FALSE_POSITIVE' | 'FALSE_NEGATIVE' | 'ERROR';
  mapping_reason?: string;
  ending_reason?: string;
}

interface ErrorPattern {
  pattern: string;
  count: number;
  examples: string[];
}

async function main() {
  const limit = parseInt(process.argv[2]) || 50;
  console.log(`\n========================================`);
  console.log(`  Full Accuracy Validation`);
  console.log(`  Sample Size: ${limit} videos`);
  console.log(`========================================\n`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error']
  });

  const supabaseProvider = app.get(SupabaseClientProvider);
  const supabase = supabaseProvider.getClient();
  const aiAnalyzer = app.get<IAIAnalyzerPort>(INJECTION_TOKENS.AI_ANALYZER);
  const contentSearch = app.get<IContentSearchPort>(INJECTION_TOKENS.CONTENT_SEARCH);

  // 1. confirmed 비디오 가져오기
  console.log('Loading confirmed videos...');
  const { data: videos, error } = await supabase
    .from('videos')
    .select(`
      id,
      title,
      content_id,
      content_type,
      includes_ending,
      runtime,
      contents!inner(title)
    `)
    .eq('status', 'confirmed')
    .not('content_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error || !videos) {
    console.error('Failed to load videos:', error);
    await app.close();
    return;
  }

  const videoList: VideoData[] = videos.map((v: any) => ({
    video_id: v.id,
    video_title: v.title,
    content_id: v.content_id,
    content_type: v.content_type,
    content_title: v.contents?.title || 'Unknown',
    includes_ending: v.includes_ending,
    runtime: v.runtime || 600,
  }));

  console.log(`Loaded ${videoList.length} videos\n`);

  // 2. 각 비디오 재분석
  const results: ValidationResult[] = [];

  // Mapping counters
  let mappingMatch = 0;
  let mappingMismatch = 0;
  let mappingNoExtraction = 0;
  let mappingError = 0;

  // Ending counters
  let endingCorrect = 0;
  let endingFalsePositive = 0;  // predicted true, actual false
  let endingFalseNegative = 0;  // predicted false, actual true
  let endingError = 0;

  // Error pattern tracking
  const mappingErrorPatterns: Map<string, ErrorPattern> = new Map();
  const endingErrorPatterns: Map<string, ErrorPattern> = new Map();

  for (let i = 0; i < videoList.length; i++) {
    const video = videoList[i];
    const shortTitle = video.video_title.substring(0, 50) + (video.video_title.length > 50 ? '...' : '');
    console.log(`[${i + 1}/${videoList.length}] ${shortTitle}`);

    try {
      // Phase 1: Direct Extraction
      const phase1Result = await aiAnalyzer.extractDirectMention({
        videoId: video.video_id,
        videoTitle: video.video_title,
        videoDescription: '',
        videoDuration: video.runtime,
      });

      let mappingStatus: ValidationResult['mapping_status'] = 'NO_EXTRACTION';
      let endingStatus: ValidationResult['ending_status'] = 'ERROR';
      let mappingReason: string | undefined;
      let endingReason: string | undefined;

      let extractedTitles: string[] = [];
      let inferredTitles: string[] = [];
      let confidence = 0;
      // 키워드 기반 결말 판단 우선 적용
      const keywordEndingInitial = detectEndingFromKeywords(video.video_title);
      let predictedEnding = keywordEndingInitial || phase1Result.includesEnding;
      let selectedTmdbId: number | undefined;
      let selectedTmdbType: string | undefined;

      if (phase1Result.extractedTitle && phase1Result.confidence >= 80) {
        // Phase 1 success
        extractedTitles = [phase1Result.extractedTitle];
        confidence = phase1Result.confidence;
        // 키워드 판단 우선
        predictedEnding = keywordEndingInitial || phase1Result.includesEnding;

        const titleMatch = isTitleMatch(phase1Result.extractedTitle, video.content_title);
        if (titleMatch.match) {
          mappingStatus = 'MATCH';
          mappingMatch++;
        } else {
          mappingStatus = 'MISMATCH';
          mappingMismatch++;
          mappingReason = `Phase1: "${phase1Result.extractedTitle}" != "${video.content_title}" (${titleMatch.reason})`;
          trackErrorPattern(mappingErrorPatterns, 'Phase1_Title_Mismatch', video.video_title);
        }
      } else {
        // Phase 2: Full Analysis
        const searchTitle = phase1Result.extractedTitle || video.video_title;
        const candidates = await contentSearch.searchMulti(searchTitle);

        if (candidates.length > 0) {
          const phase2Result = await aiAnalyzer.analyzeVideoContent({
            videoId: video.video_id,
            videoDuration: video.runtime,
            tmdbCandidates: candidates.slice(0, 5),
          });

          extractedTitles = phase2Result.extractedTitles || [];
          inferredTitles = phase2Result.inferredTitles || [];
          confidence = phase2Result.confidence;
          // 키워드 기반 결말 판단 우선 적용 (실제 서버 로직과 동일)
          const keywordEnding = detectEndingFromKeywords(video.video_title);
          predictedEnding = keywordEnding || phase2Result.includesEnding;

          if (phase2Result.selectedTMDBMatch) {
            selectedTmdbId = phase2Result.selectedTMDBMatch.tmdbId;
            selectedTmdbType = phase2Result.selectedTMDBMatch.type;

            if (selectedTmdbId === video.content_id && selectedTmdbType === video.content_type) {
              mappingStatus = 'MATCH';
              mappingMatch++;
            } else {
              mappingStatus = 'MISMATCH';
              mappingMismatch++;
              mappingReason = `Phase2_TMDB: ${selectedTmdbId}(${selectedTmdbType}) != ${video.content_id}(${video.content_type})`;
              trackErrorPattern(mappingErrorPatterns, 'Phase2_TMDB_ID_Mismatch', video.video_title);
            }
          } else {
            // No TMDB selection, check titles
            const allTitles = [...extractedTitles, ...inferredTitles];
            if (allTitles.length > 0) {
              let bestMatch = { title: '', match: false, similarity: 0, reason: '' };
              for (const t of allTitles) {
                const result = isTitleMatch(t, video.content_title);
                if (result.similarity > bestMatch.similarity) {
                  bestMatch = { title: t, ...result };
                }
              }

              if (bestMatch.match) {
                mappingStatus = 'MATCH';
                mappingMatch++;
              } else {
                mappingStatus = 'MISMATCH';
                mappingMismatch++;
                mappingReason = `Phase2_Titles: [${allTitles.join(', ')}] != "${video.content_title}"`;
                trackErrorPattern(mappingErrorPatterns, 'Phase2_Title_Mismatch', video.video_title);
              }
            } else {
              mappingStatus = 'NO_EXTRACTION';
              mappingNoExtraction++;
              mappingReason = `No titles extracted (confidence: ${confidence})`;
              trackErrorPattern(mappingErrorPatterns, 'No_Extraction', video.video_title);
            }
          }
        } else {
          mappingStatus = 'NO_EXTRACTION';
          mappingNoExtraction++;
          mappingReason = 'TMDB search returned 0 results';
          trackErrorPattern(mappingErrorPatterns, 'TMDB_Zero_Results', video.video_title);
        }
      }

      // Ending accuracy check
      const actualEnding = video.includes_ending;
      if (predictedEnding === actualEnding) {
        endingStatus = 'CORRECT';
        endingCorrect++;
      } else if (predictedEnding && !actualEnding) {
        endingStatus = 'FALSE_POSITIVE';
        endingFalsePositive++;
        endingReason = `Predicted: true, Actual: false`;
        trackErrorPattern(endingErrorPatterns, 'False_Positive', video.video_title);
      } else {
        endingStatus = 'FALSE_NEGATIVE';
        endingFalseNegative++;
        endingReason = `Predicted: false, Actual: true`;
        trackErrorPattern(endingErrorPatterns, 'False_Negative', video.video_title);
      }

      results.push({
        video_id: video.video_id,
        video_title: video.video_title,
        original: {
          content_id: video.content_id,
          content_type: video.content_type,
          content_title: video.content_title,
          includes_ending: video.includes_ending,
        },
        predicted: {
          extracted_titles: extractedTitles,
          inferred_titles: inferredTitles,
          confidence,
          includes_ending: predictedEnding,
          selected_tmdb_id: selectedTmdbId,
          selected_tmdb_type: selectedTmdbType,
        },
        mapping_status: mappingStatus,
        ending_status: endingStatus,
        mapping_reason: mappingReason,
        ending_reason: endingReason,
      });

      // Progress output
      const mappingIcon = mappingStatus === 'MATCH' ? '[M:OK]' : mappingStatus === 'MISMATCH' ? '[M:NG]' : '[M:??]';
      const endingIcon = endingStatus === 'CORRECT' ? '[E:OK]' : endingStatus === 'FALSE_POSITIVE' ? '[E:FP]' : '[E:FN]';
      console.log(`   ${mappingIcon} ${endingIcon} ${mappingReason || endingReason || 'OK'}`);

      // Rate limit prevention
      await sleep(500);

    } catch (error) {
      console.log(`   [ERROR] ${(error as Error).message}`);
      mappingError++;
      endingError++;
      results.push({
        video_id: video.video_id,
        video_title: video.video_title,
        original: {
          content_id: video.content_id,
          content_type: video.content_type,
          content_title: video.content_title,
          includes_ending: video.includes_ending,
        },
        predicted: {
          extracted_titles: [],
          inferred_titles: [],
          confidence: 0,
          includes_ending: false,
        },
        mapping_status: 'ERROR',
        ending_status: 'ERROR',
        mapping_reason: (error as Error).message,
        ending_reason: (error as Error).message,
      });
    }
  }

  // 3. Generate Report
  console.log('\n' + '='.repeat(70));
  console.log('                    ACCURACY REPORT');
  console.log('='.repeat(70));

  // Overall Statistics
  const totalVideos = videoList.length;
  const mappingAccuracy = ((mappingMatch / totalVideos) * 100).toFixed(1);
  const endingAccuracy = ((endingCorrect / totalVideos) * 100).toFixed(1);

  console.log('\n--- TMDB Mapping Accuracy ---');
  console.log(`Total Videos:     ${totalVideos}`);
  console.log(`MATCH:           ${mappingMatch} (${mappingAccuracy}%)`);
  console.log(`MISMATCH:        ${mappingMismatch} (${((mappingMismatch / totalVideos) * 100).toFixed(1)}%)`);
  console.log(`NO_EXTRACTION:   ${mappingNoExtraction} (${((mappingNoExtraction / totalVideos) * 100).toFixed(1)}%)`);
  console.log(`ERROR:           ${mappingError} (${((mappingError / totalVideos) * 100).toFixed(1)}%)`);

  console.log('\n--- includes_ending Accuracy ---');
  console.log(`Total Videos:     ${totalVideos}`);
  console.log(`CORRECT:         ${endingCorrect} (${endingAccuracy}%)`);
  console.log(`FALSE_POSITIVE:  ${endingFalsePositive} (${((endingFalsePositive / totalVideos) * 100).toFixed(1)}%) [Predicted ending, but no ending]`);
  console.log(`FALSE_NEGATIVE:  ${endingFalseNegative} (${((endingFalseNegative / totalVideos) * 100).toFixed(1)}%) [Missed ending]`);
  console.log(`ERROR:           ${endingError} (${((endingError / totalVideos) * 100).toFixed(1)}%)`);

  // Precision and Recall for ending detection
  const truePositives = results.filter(r => r.predicted.includes_ending && r.original.includes_ending).length;
  const falsePositives = endingFalsePositive;
  const falseNegatives = endingFalseNegative;
  const precision = truePositives / (truePositives + falsePositives) || 0;
  const recall = truePositives / (truePositives + falseNegatives) || 0;
  const f1Score = 2 * (precision * recall) / (precision + recall) || 0;

  console.log(`\n--- Ending Detection Metrics ---`);
  console.log(`Precision:       ${(precision * 100).toFixed(1)}% (결말포함으로 판단한 것 중 실제 결말포함 비율)`);
  console.log(`Recall:          ${(recall * 100).toFixed(1)}% (실제 결말포함 중 감지한 비율)`);
  console.log(`F1 Score:        ${(f1Score * 100).toFixed(1)}%`);

  // Error Pattern Analysis
  console.log('\n' + '='.repeat(70));
  console.log('                    ERROR PATTERN ANALYSIS');
  console.log('='.repeat(70));

  console.log('\n--- Top 5 Mapping Error Patterns ---');
  const sortedMappingPatterns = Array.from(mappingErrorPatterns.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  sortedMappingPatterns.forEach((pattern, i) => {
    console.log(`\n${i + 1}. ${pattern.pattern} (${pattern.count} cases)`);
    pattern.examples.slice(0, 3).forEach(ex => {
      console.log(`   - ${ex.substring(0, 60)}...`);
    });
  });

  console.log('\n--- Top 5 Ending Detection Error Patterns ---');
  const sortedEndingPatterns = Array.from(endingErrorPatterns.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  sortedEndingPatterns.forEach((pattern, i) => {
    console.log(`\n${i + 1}. ${pattern.pattern} (${pattern.count} cases)`);
    pattern.examples.slice(0, 3).forEach(ex => {
      console.log(`   - ${ex.substring(0, 60)}...`);
    });
  });

  // Detailed Mismatch Cases
  console.log('\n' + '='.repeat(70));
  console.log('                    DETAILED MISMATCH CASES');
  console.log('='.repeat(70));

  const mappingMismatches = results.filter(r => r.mapping_status === 'MISMATCH');
  if (mappingMismatches.length > 0) {
    console.log(`\n--- Mapping Mismatches (${mappingMismatches.length} cases) ---`);
    mappingMismatches.slice(0, 10).forEach((m, i) => {
      console.log(`\n[${i + 1}] ${m.video_title.substring(0, 60)}`);
      console.log(`    Expected: ${m.original.content_title} (${m.original.content_type}, ID: ${m.original.content_id})`);
      console.log(`    Predicted: ${m.predicted.extracted_titles.join(', ') || m.predicted.inferred_titles.join(', ') || 'N/A'}`);
      if (m.predicted.selected_tmdb_id) {
        console.log(`    TMDB Selection: ID ${m.predicted.selected_tmdb_id} (${m.predicted.selected_tmdb_type})`);
      }
      console.log(`    Reason: ${m.mapping_reason}`);
    });
  }

  const endingErrors = results.filter(r => r.ending_status !== 'CORRECT' && r.ending_status !== 'ERROR');
  if (endingErrors.length > 0) {
    console.log(`\n--- Ending Prediction Errors (${endingErrors.length} cases) ---`);
    endingErrors.slice(0, 10).forEach((m, i) => {
      console.log(`\n[${i + 1}] ${m.video_title.substring(0, 60)}`);
      console.log(`    Expected: ${m.original.includes_ending ? 'TRUE (결말포함)' : 'FALSE (결말없음)'}`);
      console.log(`    Predicted: ${m.predicted.includes_ending ? 'TRUE (결말포함)' : 'FALSE (결말없음)'}`);
      console.log(`    Status: ${m.ending_status}`);
    });
  }

  // Improvement Suggestions
  console.log('\n' + '='.repeat(70));
  console.log('                    IMPROVEMENT SUGGESTIONS');
  console.log('='.repeat(70));

  generateImprovementSuggestions(results, mappingErrorPatterns, endingErrorPatterns);

  // Save results to JSON
  const reportData = {
    timestamp: new Date().toISOString(),
    sample_size: totalVideos,
    mapping: {
      accuracy: parseFloat(mappingAccuracy),
      match: mappingMatch,
      mismatch: mappingMismatch,
      no_extraction: mappingNoExtraction,
      error: mappingError,
    },
    ending: {
      accuracy: parseFloat(endingAccuracy),
      correct: endingCorrect,
      false_positive: endingFalsePositive,
      false_negative: endingFalseNegative,
      error: endingError,
      precision: parseFloat((precision * 100).toFixed(1)),
      recall: parseFloat((recall * 100).toFixed(1)),
      f1_score: parseFloat((f1Score * 100).toFixed(1)),
    },
    results,
  };

  const reportPath = 'analysis_result.json';
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
  console.log(`\nResults saved to ${reportPath}`);

  await app.close();
  console.log('\nValidation complete.\n');
}

// Helper functions

function trackErrorPattern(patterns: Map<string, ErrorPattern>, patternName: string, example: string) {
  const existing = patterns.get(patternName);
  if (existing) {
    existing.count++;
    if (existing.examples.length < 5) {
      existing.examples.push(example);
    }
  } else {
    patterns.set(patternName, {
      pattern: patternName,
      count: 1,
      examples: [example],
    });
  }
}

function normalizeKoreanPhonetics(text: string): string {
  return text
    .replace(/크로/g, '클로')
    .replace(/메트/g, '매트')
    .replace(/레/g, '래')
    .replace(/웨/g, '워')
    .replace(/쉬/g, '시')
    .replace(/팬/g, '판')
    .replace(/프로/g, '크루');
}

function normalizeTitle(title: string): string {
  let normalized = title
    .toLowerCase()
    .replace(/[:\s\-_.,!?'"()【】《》\[\]]/g, '')
    .replace(/시즌\d+/g, '')
    .replace(/season\d+/gi, '')
    .trim();

  normalized = normalizeKoreanPhonetics(normalized);
  return normalized;
}

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

function similarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(str1, str2) / maxLen;
}

function extractCoreWord(title: string): string {
  const words = title.split(/[\s\-_:]/);
  const meaningful = words.filter(w => w.length >= 2 && !['the', 'a', 'an', '더'].includes(w.toLowerCase()));
  if (meaningful.length === 0) return title;
  return meaningful.reduce((a, b) => a.length >= b.length ? a : b);
}

function isTitleMatch(extracted: string, original: string): { match: boolean; similarity: number; reason: string } {
  const extractedNorm = normalizeTitle(extracted);
  const originalNorm = normalizeTitle(original);

  if (extractedNorm === originalNorm) {
    return { match: true, similarity: 1.0, reason: 'exact_match' };
  }

  if (extractedNorm.includes(originalNorm) || originalNorm.includes(extractedNorm)) {
    return { match: true, similarity: 0.95, reason: 'contains' };
  }

  const fullSim = similarity(extractedNorm, originalNorm);
  if (fullSim >= 0.75) {
    return { match: true, similarity: fullSim, reason: `phonetic_similar(${(fullSim * 100).toFixed(0)}%)` };
  }

  const extractedCore = normalizeTitle(extractCoreWord(extracted));
  const originalCore = normalizeTitle(extractCoreWord(original));
  const coreSim = similarity(extractedCore, originalCore);

  if (coreSim >= 0.75 && extractedCore.length >= 2 && originalCore.length >= 2) {
    return { match: true, similarity: coreSim, reason: `core_word_match(${(coreSim * 100).toFixed(0)}%)` };
  }

  return { match: false, similarity: fullSim, reason: `no_match(${(fullSim * 100).toFixed(0)}%)` };
}

function generateImprovementSuggestions(
  results: ValidationResult[],
  mappingPatterns: Map<string, ErrorPattern>,
  endingPatterns: Map<string, ErrorPattern>,
) {
  const suggestions: string[] = [];

  // Mapping suggestions
  const noExtractionCount = results.filter(r => r.mapping_status === 'NO_EXTRACTION').length;
  if (noExtractionCount > results.length * 0.1) {
    suggestions.push(`1. [MAPPING] High NO_EXTRACTION rate (${noExtractionCount}/${results.length}):
   - Consider enhancing Phase 1 prompt to better handle clickbait titles
   - Add more few-shot examples for common YouTube title patterns
   - Implement web search fallback earlier in the pipeline`);
  }

  const phase2Mismatches = results.filter(r => r.mapping_reason?.includes('Phase2'));
  if (phase2Mismatches.length > 5) {
    suggestions.push(`2. [MAPPING] Phase 2 TMDB selection issues (${phase2Mismatches.length} cases):
   - Review TMDB candidate ranking algorithm
   - Consider giving more weight to release year matching
   - Improve plot comparison algorithm for disambiguation`);
  }

  // Ending suggestions
  const falsePositives = results.filter(r => r.ending_status === 'FALSE_POSITIVE');
  if (falsePositives.length > results.length * 0.05) {
    suggestions.push(`3. [ENDING] High false positive rate (${falsePositives.length} cases):
   - Review keywords that trigger false ending detection
   - Check if "review" or "summary" videos are being marked as ending-included
   - Consider adding negative keywords: "no spoilers", "spoiler-free"`);
  }

  const falseNegatives = results.filter(r => r.ending_status === 'FALSE_NEGATIVE');
  if (falseNegatives.length > results.length * 0.05) {
    suggestions.push(`4. [ENDING] High false negative rate (${falseNegatives.length} cases):
   - Add more ending detection patterns for implicit endings
   - Check transcript end section for ending narrative patterns
   - Consider expanding keyword list for ending detection`);
  }

  // Pattern-specific suggestions
  if (mappingPatterns.has('TMDB_Zero_Results')) {
    const pattern = mappingPatterns.get('TMDB_Zero_Results')!;
    if (pattern.count > 3) {
      suggestions.push(`5. [MAPPING] TMDB search returning 0 results (${pattern.count} cases):
   - Implement title normalization before TMDB search
   - Add romanization fallback for Korean titles
   - Consider using web search to find correct title first`);
    }
  }

  if (suggestions.length === 0) {
    suggestions.push('No critical issues detected. Current accuracy is acceptable.');
  }

  suggestions.forEach(s => console.log(`\n${s}`));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(e => {
  console.error('Script execution error:', e);
  process.exit(1);
});
