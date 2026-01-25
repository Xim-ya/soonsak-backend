import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@/database';
import { YouTubeExtractorService, YouTubeScriptService } from '@/youtube';
import { TMDBService } from '@/tmdb';
import { YouTubeRSSEntry, TMDBMatchResult, VideoProcessingResult } from '@/common/types';
import { delay } from '@/common/utils';

/**
 * 비디오 프로세서 서비스
 * 핵심 비디오 처리 로직: YouTube 추출, TMDB 매칭, 데이터베이스 저장
 */
@Injectable()
export class VideoProcessorService {
  private readonly logger = new Logger(VideoProcessorService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly extractorService: YouTubeExtractorService,
    private readonly scriptService: YouTubeScriptService,
    private readonly tmdbService: TMDBService,
  ) {}

  /**
   * 단일 비디오 처리
   */
  async processVideo(rssEntry: YouTubeRSSEntry): Promise<VideoProcessingResult> {
    const { videoId, title } = rssEntry;
    this.logger.log(`Processing video: ${title} (${videoId})`);

    try {
      const exists = await this.databaseService.videoExists(videoId);
      if (exists) {
        return {
          success: false,
          message: '이미 처리된 동영상입니다',
        };
      }

      const videoInfo = await this.extractorService.getVideoInfo(videoId);
      this.logger.log(`  Video duration: ${Math.round(videoInfo.duration / 60)}분`);

      const titleCandidates = this.extractTitleCandidates(videoInfo.title, videoInfo.description);
      this.logger.log(`  Title candidates: ${titleCandidates.join(', ')}`);

      const tmdbCandidates: TMDBMatchResult[] = [];
      const searchResults: string[] = [];

      for (const candidate of titleCandidates.slice(0, 5)) {
        if (candidate.length < 2 || candidate.length > 30) continue;

        try {
          const results = await this.tmdbService.searchMulti(candidate);
          searchResults.push(`${candidate}:${results.length}`);
          for (const result of results) {
            if (!tmdbCandidates.find((c) => c.data.id === result.data.id)) {
              tmdbCandidates.push({
                ...result,
                confidence: 0,
                searchTerm: candidate,
              });
            }
          }
        } catch (err) {
          searchResults.push(`${candidate}:ERR`);
        }
        await delay(100);
      }

      this.logger.log(`  Found ${tmdbCandidates.length} TMDB candidates (${searchResults.join(', ')})`);

      const shouldRunAI = tmdbCandidates.length === 0 || tmdbCandidates.length <= 3;

      if (shouldRunAI) {
        this.logger.log(`  AI 자막 분석 실행 (패턴 후보: ${tmdbCandidates.length}개)...`);
        try {
          const aiAnalysis = await this.scriptService.analyzeVideoWithTMDBCandidates(
            videoId,
            videoInfo.duration,
            [],
          );

          this.logger.log(
            `  AI 분석 결과: ${JSON.stringify({
              extractedTitles: aiAnalysis.extractedTitles,
              includesEnding: aiAnalysis.includesEnding,
              confidence: aiAnalysis.confidence,
            })}`,
          );

          const minConfidence = 70;
          const extractedTitles = aiAnalysis.extractedTitles || [];
          if (aiAnalysis.confidence >= minConfidence && extractedTitles.length > 0) {
            this.logger.log(`  AI 추출 제목: ${extractedTitles.join(', ')}`);

            for (const aiTitle of extractedTitles.slice(0, 3)) {
              if (aiTitle.length < 2 || aiTitle.length > 30) continue;

              try {
                const results = await this.tmdbService.searchMulti(aiTitle);
                searchResults.push(`AI:${aiTitle}:${results.length}`);
                for (const result of results) {
                  if (!tmdbCandidates.find((c) => c.data.id === result.data.id)) {
                    tmdbCandidates.unshift({
                      ...result,
                      confidence: aiAnalysis.confidence,
                      searchTerm: `AI:${aiTitle}`,
                    });
                  }
                }
              } catch (err) {
                searchResults.push(`AI:${aiTitle}:ERR`);
              }
              await delay(100);
            }

            this.logger.log(`  AI 추가 후 TMDB candidates: ${tmdbCandidates.length}`);
          } else if (aiAnalysis.confidence < minConfidence) {
            this.logger.warn(`  AI 신뢰도 부족 (${aiAnalysis.confidence}% < ${minConfidence}%)`);
          } else {
            this.logger.warn('  AI가 제목을 추출하지 못함');
          }
        } catch (error) {
          this.logger.warn(`  AI 자막 분석 실패: ${(error as Error).message}`);
        }
      }

      if (tmdbCandidates.length === 0) {
        return {
          success: false,
          message: `TMDB 매칭 실패 - 검색결과: [${searchResults.join(', ')}]`,
        };
      }

      let selectedMatch: TMDBMatchResult | null = null;
      let includesEnding = this.detectEndingFromContent(videoInfo.title, videoInfo.description);

      if (tmdbCandidates.length > 0) {
        try {
          const analysis = await this.scriptService.analyzeVideoWithTMDBCandidates(
            videoId,
            videoInfo.duration,
            tmdbCandidates,
          );

          includesEnding = analysis.includesEnding;

          if (analysis.selectedTMDBMatch) {
            selectedMatch =
              tmdbCandidates.find((c) => c.data.id === analysis.selectedTMDBMatch?.tmdbId) || null;
          }

          this.logger.log(`  AI analysis: ${includesEnding ? '결말포함' : '결말없음'}`);
        } catch (error) {
          this.logger.warn('  AI analysis failed, using first candidate');
        }
      }

      if (!selectedMatch) {
        selectedMatch = this.selectBestCandidate(tmdbCandidates, titleCandidates, videoInfo.description);
      }

      const tmdbData = selectedMatch.data;
      const tmdbTitle = selectedMatch.type === 'movie' ? tmdbData.title : tmdbData.name;

      this.logger.log(`  Selected TMDB: ${tmdbTitle} (${selectedMatch.type})`);

      const channelId = await this.databaseService.getOrCreateChannel(
        videoInfo.channelId,
        videoInfo.channelTitle,
      );

      const contentId = await this.databaseService.upsertContent({
        id: tmdbData.id,
        contentType: selectedMatch.type,
        title: tmdbTitle || '',
        posterPath: tmdbData.posterPath,
        uploadedAt: new Date().toISOString(),
      });

      const newVideoRuntime = Math.round(videoInfo.duration / 60);
      const existingVideos = await this.databaseService.getVideosByContentId(contentId);

      let isPrimary = false;

      if (existingVideos.length === 0) {
        isPrimary = true;
        this.logger.log(`  First video for content → isPrimary: true`);
      } else {
        const currentPrimary = existingVideos.find((v) => v.isPrimary);

        if (!currentPrimary) {
          isPrimary = true;
          this.logger.log(`  No primary video exists → isPrimary: true`);
        } else {
          const newHasEnding = includesEnding;
          const currentHasEnding = currentPrimary.includesEnding;

          if (newHasEnding && !currentHasEnding) {
            isPrimary = true;
            await this.databaseService.updateVideoPrimary(currentPrimary.id, false);
            this.logger.log(`  결말포함 우선 → isPrimary: true`);
          } else if (!newHasEnding && currentHasEnding) {
            this.logger.log(`  기존 영상이 결말포함 → isPrimary: false`);
          } else {
            if (newVideoRuntime > currentPrimary.runtime) {
              isPrimary = true;
              await this.databaseService.updateVideoPrimary(currentPrimary.id, false);
              this.logger.log(
                `  런타임 비교 (${newVideoRuntime}분 > ${currentPrimary.runtime}분) → isPrimary: true`,
              );
            } else {
              this.logger.log(
                `  런타임 비교 (${newVideoRuntime}분 <= ${currentPrimary.runtime}분) → isPrimary: false`,
              );
            }
          }
        }
      }

      await this.databaseService.upsertVideo({
        id: videoId,
        contentId,
        contentType: selectedMatch.type,
        title: videoInfo.title,
        runtime: newVideoRuntime,
        thumbnailUrl: videoInfo.thumbnail,
        isPrimary,
        channelId,
        includesEnding,
        uploadedAt: videoInfo.publishedAt,
        updatedAt: new Date().toISOString(),
      });

      this.logger.log(`  ✅ Saved: ${videoInfo.title} → ${tmdbTitle}`);

      return {
        success: true,
        message: '동영상 처리 완료',
        data: {
          videoId,
          youtubeTitle: videoInfo.title,
          tmdbTitle: tmdbTitle || '',
          tmdbType: selectedMatch.type,
          tmdbId: tmdbData.id,
          includesEnding,
          contentId,
        },
      };
    } catch (error) {
      this.logger.error(`  ❌ Processing failed: ${(error as Error).message}`);
      return {
        success: false,
        message: `처리 실패: ${(error as Error).message}`,
      };
    }
  }

  /**
   * YouTube 제목과 설명에서 영화/TV 제목 후보 추출
   */
  private extractTitleCandidates(youtubeTitle: string, description?: string): string[] {
    const candidates: string[] = [];

    // 패턴 1: "제목 | 기타정보"
    const pipe = youtubeTitle.match(/^([^|]+)\s*\|/);
    if (pipe?.[1]?.trim()) {
      candidates.push(pipe[1].trim());
    }

    // 패턴 2: "[카테고리] 제목"
    const bracket = youtubeTitle.match(/\[.*?\]\s*(.+)/);
    if (bracket?.[1]?.trim()) {
      candidates.push(bracket[1].trim());
    }

    // 패턴 3: "제목 - 기타정보"
    const dash = youtubeTitle.match(/^([^-]+)\s*-/);
    if (dash?.[1]?.trim() && dash[1].trim().length > 2) {
      candidates.push(dash[1].trim());
    }

    // 패턴 4: "제목 (연도)"
    const paren = youtubeTitle.match(/^(.+?)\s*\(/);
    if (paren?.[1]?.trim()) {
      candidates.push(paren[1].trim());
    }

    // 패턴 5: 해시태그
    const allText = youtubeTitle + ' ' + (description || '');
    const hashtags = allText.match(/#([가-힣a-zA-Z0-9]+)/g);
    if (hashtags) {
      hashtags.forEach((tag) => {
        const cleaned = tag.replace('#', '').trim();
        const excludeKeywords = [
          '영화리뷰',
          '결말포함',
          '결말',
          '리뷰',
          '넷플릭스',
          '영화추천',
          '드라마',
          '영화',
        ];
        if (
          cleaned.length >= 2 &&
          cleaned.length <= 20 &&
          !excludeKeywords.includes(cleaned) &&
          !candidates.includes(cleaned)
        ) {
          candidates.push(cleaned);
        }
      });
    }

    // 패턴 6: 인용 텍스트
    const quoted = youtubeTitle.match(/"([^"]{2,20})"/g);
    if (quoted) {
      quoted.forEach((q) => {
        const cleaned = q.replace(/"/g, '').trim();
        if (!candidates.includes(cleaned)) {
          candidates.push(cleaned);
        }
      });
    }

    if (description) {
      // 패턴 7: 설명의 첫 줄
      const firstLine = description.split('\n')[0]?.trim();
      if (firstLine && firstLine.length >= 2 && firstLine.length <= 50) {
        if (!/^\d/.test(firstLine) && /[가-힣a-zA-Z]/.test(firstLine)) {
          const cleanedFirstLine = firstLine.replace(/^(영화|제목|작품|Movie|Title)\s*[:：]\s*/i, '').trim();

          const bilingualMatch = cleanedFirstLine.match(/^([가-힣\s]+)\s*\(([a-zA-Z\s:'\-]+),?\s*\d{4}\)$/);
          if (bilingualMatch) {
            const koreanTitle = bilingualMatch[1].trim();
            const englishTitle = bilingualMatch[2].trim();
            if (koreanTitle.length >= 2 && !candidates.includes(koreanTitle)) {
              candidates.push(koreanTitle);
            }
            if (englishTitle.length >= 2 && !candidates.includes(englishTitle)) {
              candidates.push(englishTitle);
            }
          } else if (
            cleanedFirstLine.length >= 2 &&
            cleanedFirstLine.length <= 30 &&
            !candidates.includes(cleanedFirstLine)
          ) {
            candidates.push(cleanedFirstLine);
          }
        }
      }

      // 패턴 8: 특수 인용 부호
      const specialQuotes = description.match(/[「『<《]([^」』>》]{2,20})[」』>》]/g);
      if (specialQuotes) {
        specialQuotes.forEach((q) => {
          const cleaned = q.replace(/[「」『』<>《》]/g, '').trim();
          if (cleaned.length >= 2 && !candidates.includes(cleaned)) {
            candidates.push(cleaned);
          }
        });
      }

      // 패턴 9: 설명 내 인용 텍스트
      const descQuoted = description.match(/["']([^"']{2,20})["']/g);
      if (descQuoted) {
        descQuoted.forEach((q) => {
          const cleaned = q.replace(/["']/g, '').trim();
          if (cleaned.length >= 2 && !candidates.includes(cleaned)) {
            candidates.push(cleaned);
          }
        });
      }

      // 패턴 10: 원제 패턴
      const originalTitle = description.match(/원제[목]?\s*[:：]\s*([^\n,]{2,30})/);
      if (originalTitle?.[1]?.trim()) {
        const cleaned = originalTitle[1].trim();
        if (!candidates.includes(cleaned)) {
          candidates.push(cleaned);
        }
      }

      // 패턴 10-2: 연도가 포함된 인라인 제목
      const inlineTitleMatches = description.match(
        /(?:^|[\s,."'·:])([가-힣a-zA-Z][가-힣a-zA-Z0-9]{0,15})\s*\((\d{4})\)/g,
      );
      if (inlineTitleMatches) {
        inlineTitleMatches.forEach((match) => {
          const titleMatch = match.match(/([가-힣a-zA-Z][가-힣a-zA-Z0-9]{0,15})\s*\(\d{4}\)/);
          if (titleMatch?.[1]) {
            const title = titleMatch[1].trim();
            if (title.length >= 2 && title.length <= 15 && !candidates.includes(title)) {
              candidates.push(title);
            }
          }
        });
      }

      // 패턴 10-1: 라벨이 붙은 제목
      const labeledTitle = description.match(
        /(?:영상[-\s]*)?(?:영화|드라마|작품|시리즈)\s*[:：]\s*([^\n]{2,30})/,
      );
      if (labeledTitle?.[1]?.trim()) {
        const cleaned = labeledTitle[1].trim();
        if (!candidates.includes(cleaned)) {
          candidates.push(cleaned);
        }
      }

      // 패턴 11: 별도 줄의 연도가 포함된 제목
      const lines = description.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        const movieTitleMatch = trimmed.match(/^([가-힣a-zA-Z0-9\s:·\-]+)\s*\(?(\d{4})\)?$/);
        if (movieTitleMatch?.[1]) {
          const title = movieTitleMatch[1].trim();
          if (title.length >= 2 && title.length <= 25 && !candidates.includes(title)) {
            candidates.push(title);
          }
        }

        // 패턴 12: 이모지 + 제목
        const strippedLine = trimmed.replace(/^[\u{1F3AC}\u{1F3A5}\u{1F39E}\u{1F4FD}\u{1F3A6}]\s*/u, '');
        if (strippedLine !== trimmed) {
          const titleMatch = strippedLine.match(/^([가-힣a-zA-Z0-9\s:·\-]+)\s*\(/);
          if (titleMatch?.[1]) {
            const title = titleMatch[1].trim();
            if (title.length >= 2 && title.length <= 25 && !candidates.includes(title)) {
              candidates.push(title);
            }
          }
        }
      }
    }

    return [...new Set(candidates)].filter((c) => c.length >= 2);
  }

  /**
   * 제목과 설명에서 결말 포함 여부 감지
   */
  private detectEndingFromContent(title: string, description?: string): boolean {
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

    if (explicitKeywords.some((keyword) => text.includes(keyword))) {
      return true;
    }

    const seriesPatterns = [
      /시즌\s*\d+[\s\S]*시즌\s*\d+/,
      /시즌\s*1[\s\S]*뉴\s*블러드/,
      /전편/,
      /총집편/,
      /몰아보기/,
      /전체\s*정리/,
      /완전\s*정리/,
      /처음부터\s*끝까지/,
    ];

    if (seriesPatterns.some((pattern) => pattern.test(text))) {
      return true;
    }

    const seasonMatches = text.match(/시즌\s*\d+/g);
    if (seasonMatches && seasonMatches.length >= 3) {
      return true;
    }

    return false;
  }

  /**
   * 점수 기반 최적 TMDB 후보 선택
   */
  private selectBestCandidate(
    candidates: TMDBMatchResult[],
    titleCandidates: string[],
    description?: string,
  ): TMDBMatchResult {
    if (candidates.length === 1) {
      return candidates[0];
    }

    let yearHint: number | null = null;
    if (description) {
      const yearMatch = description.match(/\((\d{4})\)/);
      if (yearMatch) {
        yearHint = parseInt(yearMatch[1], 10);
      }
    }

    const hasMovieEmoji = description?.includes('🎬') || false;

    const scored = candidates.map((candidate) => {
      let score = 0;
      const tmdbTitle = candidate.type === 'movie' ? candidate.data.title : candidate.data.name;

      if (titleCandidates.some((t) => t.toLowerCase() === tmdbTitle?.toLowerCase())) {
        score += 10;
      }

      if (hasMovieEmoji && candidate.type === 'movie') {
        score += 5;
      }

      if (yearHint) {
        const releaseDate = candidate.type === 'movie' ? candidate.data.releaseDate : candidate.data.firstAirDate;
        if (releaseDate) {
          const releaseYear = parseInt(releaseDate.split('-')[0], 10);
          if (releaseYear === yearHint) {
            score += 8;
          }
        }
      }

      score += candidates.indexOf(candidate) === 0 ? 2 : 0;

      return { candidate, score };
    });

    scored.sort((a, b) => b.score - a.score);

    this.logger.log(
      `  Candidate scores: ${scored.map((s) => `${s.candidate.type}:${s.candidate.data.id}=${s.score}`).join(', ')}`,
    );

    return scored[0].candidate;
  }
}
