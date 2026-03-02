import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS, MESSAGES, TMDB_CONFIG, TMDB_GENRE_REVERSE_MAP } from '@/shared/constants';
import { compareTwoStrings, comparePlotContent } from '@/shared/utils/string.util';
import { Video, Content, Channel, VideoStatus } from '@/domain/entities';
import { VideoId, TMDBId } from '@/domain/value-objects';
import { IVideoRepository, IContentRepository, IChannelRepository } from '@/domain/repositories';
import {
  TitleExtractionService,
  EndingDetectionService,
  PrimaryVideoSelectionService,
  TMDBMatchResult,
  AIInferenceInfo,
} from '@/domain/services';
import {
  IYouTubeExtractorPort,
  IContentSearchPort,
  IAIAnalyzerPort,
  IWebSearchPort,
} from '@/application/ports';
import { AIAnalysisError } from '@/domain/errors/domain.error';
import { RegisterVideoInput, RegisterVideoResult } from './register-video.dto';

/**
 * 비디오 등록 Use Case
 * 핵심 비디오 등록 로직: YouTube 추출, TMDB 매칭, 데이터베이스 저장
 */
@Injectable()
export class RegisterVideoUseCase {
  private readonly logger = new Logger(RegisterVideoUseCase.name);

  constructor(
    @Inject(INJECTION_TOKENS.VIDEO_REPOSITORY)
    private readonly videoRepository: IVideoRepository,
    @Inject(INJECTION_TOKENS.CONTENT_REPOSITORY)
    private readonly contentRepository: IContentRepository,
    @Inject(INJECTION_TOKENS.CHANNEL_REPOSITORY)
    private readonly channelRepository: IChannelRepository,
    @Inject(INJECTION_TOKENS.YOUTUBE_EXTRACTOR)
    private readonly youtubeExtractor: IYouTubeExtractorPort,
    @Inject(INJECTION_TOKENS.CONTENT_SEARCH)
    private readonly contentSearch: IContentSearchPort,
    @Inject(INJECTION_TOKENS.AI_ANALYZER)
    private readonly aiAnalyzer: IAIAnalyzerPort,
    @Inject(INJECTION_TOKENS.WEB_SEARCH)
    private readonly webSearch: IWebSearchPort,
    private readonly titleExtractionService: TitleExtractionService,
    private readonly endingDetectionService: EndingDetectionService,
    private readonly primaryVideoSelectionService: PrimaryVideoSelectionService,
  ) {}

  async execute(input: RegisterVideoInput): Promise<RegisterVideoResult> {
    const { videoId, title } = input;
    this.logger.log(`Registering video: ${title} (${videoId})`);

    try {
      const exists = await this.videoRepository.exists(VideoId.fromString(videoId));
      if (exists) {
        return {
          success: false,
          message: MESSAGES.VIDEO.ALREADY_PROCESSED,
        };
      }

      // 쇼츠 조기 감지 (youtubei.js 사용, rate limit 영향 적음)
      // yt-dlp 호출 전에 체크하여 API 호출 최소화
      const shortsCheck = await this.youtubeExtractor.checkIfShorts(videoId);
      if (shortsCheck.isShorts) {
        this.logger.log(`  Skipping Shorts video: ${title} (${shortsCheck.duration}초)`);
        return {
          success: false,
          message: '쇼츠 영상은 등록 대상이 아닙니다',
        };
      }

      const videoInfo = await this.youtubeExtractor.getVideoInfo(videoId);

      // 이중 체크: 쇼츠 조기 감지 실패 시 대비
      if (videoInfo.isShorts) {
        this.logger.log(`  Skipping Shorts video: ${videoInfo.title}`);
        return {
          success: false,
          message: '쇼츠 영상은 등록 대상이 아닙니다',
        };
      }

      this.logger.log(`  Video duration: ${videoInfo.duration}초 (${Math.round(videoInfo.duration / 60)}분)`);

      let selectedMatch: TMDBMatchResult | null = null;
      let includesEnding = this.endingDetectionService.detectFromContent(
        videoInfo.title,
        videoInfo.description,
      );
      let aiExtractedTitles: string[] = [];
      let aiInferredTitles: string[] = [];
      let aiEnglishTitles: string[] = [];
      const allTmdbCandidates: TMDBMatchResult[] = [];
      let matchConfidence = 0; // 매칭 신뢰도 (0-100)
      let aiConfidence = 0; // AI 분석 신뢰도

      // 미디어 타입 힌트 추출 (YouTube 제목에서 "드라마" vs "영화" 감지)
      const mediaTypeHint = this.extractMediaTypeHint(videoInfo.title);

      // === Phase 1: 직접 추출 (Simple Extraction) ===
      // 명시적으로 언급된 제목만 추출, confidence >= 80이면 Phase 2 스킵
      this.logger.log(`  [Phase 1] Direct extraction...`);

      let phase1Success = false;
      let phase1MediaTypeHint: 'movie' | 'tv' | null = null;

      try {
        const directResult = await this.aiAnalyzer.extractDirectMention({
          videoId,
          videoTitle: videoInfo.title,
          videoDescription: videoInfo.description,
        });

        this.logger.log(`  [Phase 1] Result: title="${directResult.extractedTitle}", confidence=${directResult.confidence}, mediaType=${directResult.mediaTypeHint}`);

        if (directResult.extractedTitle && directResult.confidence >= 80) {
          // Phase 1 성공: Phase 2 스킵
          phase1Success = true;
          aiExtractedTitles = [directResult.extractedTitle];
          aiConfidence = directResult.confidence;
          includesEnding = directResult.includesEnding;
          // anime/documentary를 movie로 변환 (TMDB API 호환성)
          phase1MediaTypeHint = this.convertMediaTypeHint(directResult.mediaTypeHint);

          this.logger.log(`  [Phase 1] SUCCESS - Skipping Phase 2`);
        } else if (directResult.extractedTitle && directResult.confidence >= 60) {
          // 중간 신뢰도: Phase 2로 확인하되 Phase 1 결과 유지
          aiExtractedTitles = [directResult.extractedTitle];
          includesEnding = directResult.includesEnding || includesEnding;
          // anime/documentary를 movie로 변환 (TMDB API 호환성)
          phase1MediaTypeHint = this.convertMediaTypeHint(directResult.mediaTypeHint);

          this.logger.log(`  [Phase 1] PARTIAL - Will verify with Phase 2`);
        } else {
          this.logger.log(`  [Phase 1] FAILED - Proceeding to Phase 2`);
        }
      } catch (phase1Error) {
        this.logger.warn(`  [Phase 1] Error: ${(phase1Error as Error).message}`);
      }

      // === Phase 2: 추론 분석 (Inference) ===
      // Phase 1 실패 시에만 실행
      if (!phase1Success) {
        this.logger.log(`  [Phase 2] Inference analysis...`);
        try {
          const aiAnalysis = await this.aiAnalyzer.analyzeVideoContent({
            videoId,
            videoDuration: videoInfo.duration,
            tmdbCandidates: [],
          });

          // Phase 1에서 추출한 제목이 있으면 유지, 없으면 Phase 2 결과 사용
          if (aiExtractedTitles.length === 0) {
            aiExtractedTitles = aiAnalysis.extractedTitles || [];
          }
          aiInferredTitles = aiAnalysis.inferredTitles || [];
          aiEnglishTitles = aiAnalysis.englishTitles || [];
          includesEnding = aiAnalysis.includesEnding;
          aiConfidence = aiAnalysis.confidence || 0;

          this.logger.log(`  [Phase 2] Confidence: ${aiConfidence}`);

          // AI 추론 정보 (장르/연도/미디어타입 가중치용)
          const aiInference: AIInferenceInfo = {
            inferredYear: aiAnalysis.inferredYear,
            inferredGenres: aiAnalysis.inferredGenres,
            mediaTypeHint: phase1MediaTypeHint || mediaTypeHint,
          };

          // 디버그: AI 추론 정보 로그
          if (aiInference.inferredYear) {
            this.logger.log(`  [Phase 2] Inferred year: ${aiInference.inferredYear}`);
          }
          if (aiInference.inferredGenres && aiInference.inferredGenres.length > 0) {
            this.logger.log(`  [Phase 2] Inferred genres: ${aiInference.inferredGenres.join(', ')}`);
          }

          // Phase 2-1. 직접 언급 제목으로 매칭 시도
          if (aiExtractedTitles.length > 0) {
            this.logger.log(`  [Phase 2] Extracted titles: ${aiExtractedTitles.join(', ')}`);
            selectedMatch = await this.matchFromTitles(aiExtractedTitles, allTmdbCandidates, videoInfo.description, 'ai', aiInference, videoId, videoInfo.title);
            if (selectedMatch) {
              matchConfidence = 90; // 직접 언급 제목 매칭 = 높은 신뢰도
            }
          } else {
            this.logger.log(`  [Phase 2] No titles directly extracted`);
          }

          // Phase 2-2. 직접 언급 실패 → 줄거리 추론 제목으로 폴백
          // 단, searchQueries가 있고 추론 제목과 의미적으로 불일치하면 스킵 (웹 검색으로 위임)
          const hasSearchQueries = aiAnalysis.searchQueries && aiAnalysis.searchQueries.length > 0;
          let skipInferredMatch = false;

          if (!selectedMatch && aiInferredTitles.length > 0) {
            this.logger.log(`  [Phase 2] Inferred titles (plot-based): ${aiInferredTitles.join(', ')}`);

            // 추론 제목이 searchQueries와 의미적으로 맞는지 검증
            // 검색 쿼리에 다수의 컨텍스트 키워드(장르, 국가, 플롯)가 있으면 제목 불확실 신호
            if (hasSearchQueries) {
              const queriesText = aiAnalysis.searchQueries!.join(' ').toLowerCase();

              // 컨텍스트 키워드: 장르, 국가, 미디어 타입, 플롯 요소 등
              const contextKeywords = [
                // 미디어 타입/장르
                'drama', 'movie', 'film', 'show', 'series', 'thriller', 'horror', 'romance',
                'action', 'comedy', 'mystery', 'sci-fi', 'fantasy', 'crime', 'war',
                // 국가/플랫폼
                'korean', 'k-drama', 'kdrama', 'japan', 'japanese', 'china', 'chinese',
                'netflix', 'disney', 'hbo', 'hollywood',
                // 플롯 키워드
                'time', 'travel', 'warp', 'past', 'future', 'connect', 'link',
                'bear', 'wolf', 'lion', 'shark', 'animal', 'monster', 'alien',
                'ranger', 'forest', 'mountain', 'survival', 'apocalypse', 'meteor', 'zombie',
                'revenge', 'attack', 'escape', 'trapped', 'island',
              ];

              // 검색 쿼리에 포함된 컨텍스트 키워드 수 세기
              const contextCount = contextKeywords.filter(kw => queriesText.includes(kw)).length;

              // 2개 이상의 컨텍스트 키워드가 있고 추론 제목이 짧으면 (1-2 단어) → 제목 불확실
              const inferredTitleWordCount = aiInferredTitles[0].split(/\s+/).length;
              if (contextCount >= 2 && inferredTitleWordCount <= 2) {
                this.logger.log(`  [Phase 2] Search queries have ${contextCount} context keywords, inferred title is short (${inferredTitleWordCount} words) - prefer web search`);
                skipInferredMatch = true;
              }
            }

            if (!skipInferredMatch) {
              selectedMatch = await this.matchFromTitles(aiInferredTitles, allTmdbCandidates, videoInfo.description, 'ai-inferred', aiInference, videoId, videoInfo.title);

              // 짧은 한글 제목(1-2자)이 TMDB에서 못 찾아진 경우, 로마자 변환 후 재검색
              if (!selectedMatch) {
                const shortKoreanTitles = aiInferredTitles.filter(t => /^[가-힣]{1,2}$/.test(t));
                if (shortKoreanTitles.length > 0) {
                  const romanizedTitles = shortKoreanTitles.map(t => this.romanizeKorean(t)).filter(Boolean) as string[];
                  if (romanizedTitles.length > 0) {
                    this.logger.log(`  [Phase 2] Romanized short titles: ${romanizedTitles.join(', ')}`);
                    selectedMatch = await this.matchFromTitles(romanizedTitles, allTmdbCandidates, videoInfo.description, 'ai-romanized', aiInference, videoId, videoInfo.title);
                  }
                }
              }
              if (selectedMatch) {
                matchConfidence = 70; // 추론 제목 매칭 = 중간 신뢰도
              }
            }
          }

          // Phase 2-3. 영어 원제로 폴백 (한글 제목 검색 실패 시)
          // 단, 한글 제목이 추론되었으나 TMDB에서 못 찾은 경우, 영어 제목 매칭은 줄거리 검증 필요
          // skipInferredMatch가 true면 영어 제목도 동일한 AI 환각일 가능성이 높으므로 스킵
          let englishOnlyMatch = false; // 한글 제목 0건 + 영어 제목으로만 매칭된 경우

          // 검색 쿼리에 컨텍스트 키워드(장르, 국가 등)가 있으면 추론 제목만으로는 불충분한 신호
          // 예: "time travel drama cell phone" → "cell phone" 제목 + "time travel drama" 컨텍스트
          // 이 경우 웹 검색이 더 정확할 수 있음
          let skipEnglishDueToContextualQuery = false;
          if (hasSearchQueries && aiEnglishTitles.length > 0) {
            const queriesText = aiAnalysis.searchQueries!.join(' ').toLowerCase();
            const contextKeywords = ['drama', 'movie', 'film', 'korean', 'k-drama', 'kdrama', 'japan', 'china',
              'time travel', 'thriller', 'horror', 'romance', 'action', 'comedy', 'mystery',
              'netflix', 'sci-fi', 'fantasy', 'crime', 'war'];
            const hasContextInQuery = contextKeywords.some(kw => queriesText.includes(kw));

            // 검색 쿼리에 컨텍스트가 있고, 추론 제목이 짧으면 (1-2 단어) 제목 추론이 불확실할 가능성
            const englishTitleWordCount = aiEnglishTitles[0].split(/\s+/).length;
            if (hasContextInQuery && englishTitleWordCount <= 2) {
              this.logger.log(`  [Phase 2] Search queries have context keywords, English title is short (${englishTitleWordCount} words) - prefer web search`);
              skipEnglishDueToContextualQuery = true;
            }
          }

          if (!selectedMatch && aiEnglishTitles.length > 0 && !skipInferredMatch && !skipEnglishDueToContextualQuery) {
            this.logger.log(`  [Phase 2] English titles fallback: ${aiEnglishTitles.join(', ')}`);
            const englishMatch = await this.matchFromTitles(aiEnglishTitles, allTmdbCandidates, videoInfo.description, 'ai-english', aiInference, videoId, videoInfo.title);

            // 한글 제목이 추론되었는데 영어 제목으로만 매칭된 경우, 줄거리 검증 수행
            if (englishMatch && aiInferredTitles.length > 0) {
              // 한글 추론 제목이 TMDB에서 0건인지 확인
              const koreanTitleFoundInTmdb = allTmdbCandidates.some(c =>
                c.searchTerm && aiInferredTitles.includes(c.searchTerm)
              );

              if (!koreanTitleFoundInTmdb) {
                this.logger.log(`  [Verify] Korean inferred titles found 0 TMDB results - English match is uncertain`);
                englishOnlyMatch = true; // 웹 검색 트리거용 플래그
              }

              this.logger.log(`  [Verify] English match found, validating with plot comparison...`);
              const plotMatch = await this.findBestMatchByPlotComparison(videoId, allTmdbCandidates, videoInfo.title, videoInfo.description);
              if (plotMatch && plotMatch.data.id !== englishMatch.data.id) {
                this.logger.log(`  [Verify] Plot comparison suggests different movie: ${plotMatch.data.title || plotMatch.data.name} (id=${plotMatch.data.id})`);
                selectedMatch = plotMatch;
                matchConfidence = 50; // 줄거리 비교 매칭 = 낮은 신뢰도
              } else {
                selectedMatch = englishMatch;
                matchConfidence = englishOnlyMatch ? 55 : 65; // 한글 0건이면 신뢰도 낮춤
              }
            } else {
              selectedMatch = englishMatch;
              if (selectedMatch) {
                matchConfidence = 65;
              }
            }
          }

          this.logger.log(`  [Phase 2] Ending: ${includesEnding ? '결말포함' : '결말없음'}`);
          this.logger.log(`  [Phase 2] searchQueries: ${aiAnalysis.searchQueries?.join(', ') || '없음'}`);
          this.logger.log(`  [Phase 2] selectedMatch: ${selectedMatch ? `${selectedMatch.data.title || selectedMatch.data.name} (id=${selectedMatch.data.id})` : '없음'}`);
          if (skipInferredMatch) {
            this.logger.log(`  [Phase 2] skipInferredMatch: true (추론 제목이 검색어와 불일치하여 웹 검색 시도)`);
          }

          // Phase 2-4. AI 제목 추출 실패 OR 추론 제목 불일치 OR AI 신뢰도 낮음 OR 영어 제목만으로 매칭 시 웹 검색
          const needsWebSearch = !selectedMatch || skipInferredMatch || skipEnglishDueToContextualQuery || aiConfidence < 50 || englishOnlyMatch;
          if (englishOnlyMatch && selectedMatch) {
            this.logger.log(`  [Phase 2] English-only match detected - verifying with web search`);
          }
          if (needsWebSearch && aiAnalysis.searchQueries && aiAnalysis.searchQueries.length > 0) {
            if (aiConfidence < 50 && selectedMatch) {
              this.logger.log(`  [Phase 2] Low confidence (${aiConfidence}) - verifying with web search`);
            }
            this.logger.log(`  [Phase 2] Web search fallback with queries: ${aiAnalysis.searchQueries.join(', ')}`);

            // 웹 검색으로 영화 제목 추출
            const webExtractedTitles = await this.webSearch.searchAndExtractMovieTitles(aiAnalysis.searchQueries);

            if (webExtractedTitles.length > 0) {
              this.logger.log(`  [Web] Extracted titles: ${webExtractedTitles.map(t => `${t.title}(${t.year || '?'})`).join(', ')}`);

              // 연도 정보가 있는 결과를 우선 처리 (동명 영화 구분에 중요)
              const sortedWebTitles = [...webExtractedTitles].sort((a, b) => {
                // 연도가 있는 것 우선
                if (a.year && !b.year) return -1;
                if (!a.year && b.year) return 1;
                // 영어 제목이 있는 것 우선 (더 정확한 TMDB 검색 가능)
                if (a.englishTitle && !b.englishTitle) return -1;
                if (!a.englishTitle && b.englishTitle) return 1;
                // 신뢰도 높은 것 우선
                return (b.confidence || 0) - (a.confidence || 0);
              });

              // 웹 검색에서 추출한 제목으로 TMDB 검색 (모든 결과 수집 후 최종 선택)
              let webHighConfidenceMatch: TMDBMatchResult | null = null;
              let webScoringMatch: TMDBMatchResult | null = null;
              let webMatchConfidence = 0;

              for (const extracted of sortedWebTitles) {
                // 미디어 타입 접미사 정제 (타임즈(드라마) → 타임즈)
                const cleanedTitle = this.cleanMediaTypeSuffix(extracted.title);
                const searchTitles = [cleanedTitle];
                if (extracted.englishTitle && extracted.englishTitle !== cleanedTitle) {
                  searchTitles.push(extracted.englishTitle);
                }
                // 정제 전후가 다르면 원본도 검색 쿼리에 포함
                if (cleanedTitle !== extracted.title) {
                  this.logger.log(`  [Web] Cleaned title: "${extracted.title}" → "${cleanedTitle}"`);
                }

                const yearStr = extracted.year?.toString();
                const webTmdbCandidates = await this.searchTMDBCandidatesParallel(searchTitles, '', yearStr);

                for (const c of webTmdbCandidates) {
                  if (!allTmdbCandidates.find((e) => e.data.id === c.data.id)) {
                    allTmdbCandidates.push(c);
                  }
                }

                // 고신뢰도 매칭 확인 (첫 번째만 저장)
                if (!webHighConfidenceMatch) {
                  const webMatch = this.findHighConfidenceMatch(webTmdbCandidates, searchTitles);
                  if (webMatch) {
                    webHighConfidenceMatch = webMatch;
                    webMatchConfidence = extracted.confidence || 80;
                    this.logger.log(`  [Web] High-confidence candidate: ${webMatch.data.title || webMatch.data.name} (id=${webMatch.data.id})`);
                  }
                }

                // 스코어링 매칭 (첫 번째만 저장)
                if (!webScoringMatch && webTmdbCandidates.length > 0) {
                  const scoringMatch = this.primaryVideoSelectionService.selectBestCandidate(
                    webTmdbCandidates,
                    searchTitles,
                    videoInfo.description,
                    aiInference,
                  );
                  if (scoringMatch) {
                    webScoringMatch = scoringMatch;
                    if (!webHighConfidenceMatch) {
                      webMatchConfidence = Math.min(extracted.confidence || 70, 70);
                    }
                    this.logger.log(`  [Web] Scoring candidate: ${scoringMatch.data.title || scoringMatch.data.name} (id=${scoringMatch.data.id})`);
                  }
                }
              }

              // 모든 웹 후보 수집 완료 후 최종 선택 (줄거리 비교 사용)
              if (allTmdbCandidates.length >= 2) {
                this.logger.log(`  [Web] Collected ${allTmdbCandidates.length} candidates, running plot comparison`);
                const plotMatch = await this.findBestMatchByPlotComparison(videoId, allTmdbCandidates, videoInfo.title, videoInfo.description);
                if (plotMatch) {
                  selectedMatch = plotMatch;
                  matchConfidence = 75;
                  this.logger.log(`  [MATCH] Web search plot comparison -> ${plotMatch.data.title || plotMatch.data.name} (id=${plotMatch.data.id}, confidence=${matchConfidence})`);
                }
              }

              // 줄거리 비교 실패 시 고신뢰도/스코어링 매칭 사용
              if (!selectedMatch && webHighConfidenceMatch) {
                selectedMatch = webHighConfidenceMatch;
                matchConfidence = webMatchConfidence;
                this.logger.log(`  [MATCH] Web search high-confidence -> ${selectedMatch.data.title || selectedMatch.data.name} (id=${selectedMatch.data.id}, confidence=${matchConfidence})`);
              } else if (!selectedMatch && webScoringMatch) {
                selectedMatch = webScoringMatch;
                matchConfidence = webMatchConfidence;
                this.logger.log(`  [MATCH] Web search scoring -> ${selectedMatch.data.title || selectedMatch.data.name} (id=${selectedMatch.data.id}, confidence=${matchConfidence})`);
              }
            }

            // 웹 검색에서 제목 추출 실패 시, 검색 쿼리의 고유명사로 TMDB 직접 검색
            if (!selectedMatch && aiAnalysis.searchQueries) {
              const allProperNouns: string[] = [];
              for (const query of aiAnalysis.searchQueries) {
                const properNouns = this.extractProperNouns(query);
                for (const noun of properNouns) {
                  if (!allProperNouns.includes(noun)) {
                    allProperNouns.push(noun);
                  }
                }
              }

              if (allProperNouns.length > 0) {
                this.logger.log(`  [Web] Searching TMDB with proper nouns from queries: ${allProperNouns.join(', ')}`);
                const properNounCandidates = await this.searchTMDBCandidatesParallel(allProperNouns.slice(0, 3));

                for (const c of properNounCandidates) {
                  if (!allTmdbCandidates.find((e) => e.data.id === c.data.id)) {
                    allTmdbCandidates.push(c);
                  }
                }

                if (properNounCandidates.length > 0) {
                  this.logger.log(`  [Web] Found ${properNounCandidates.length} candidates from proper noun search`);

                  // 줄거리 비교로 최적 후보 선택
                  if (allTmdbCandidates.length >= 2) {
                    const plotMatch = await this.findBestMatchByPlotComparison(videoId, allTmdbCandidates, videoInfo.title, videoInfo.description);
                    if (plotMatch) {
                      selectedMatch = plotMatch;
                      matchConfidence = 70;
                      this.logger.log(`  [MATCH] Proper noun search plot comparison -> ${plotMatch.data.title || plotMatch.data.name} (id=${plotMatch.data.id}, confidence=${matchConfidence})`);
                    }
                  }

                  // 줄거리 비교 실패 시 스코어링
                  if (!selectedMatch) {
                    const scoringMatch = this.primaryVideoSelectionService.selectBestCandidate(
                      properNounCandidates,
                      allProperNouns,
                      videoInfo.description,
                      aiInference,
                    );
                    if (scoringMatch) {
                      selectedMatch = scoringMatch;
                      matchConfidence = 60;
                      this.logger.log(`  [MATCH] Proper noun search scoring -> ${scoringMatch.data.title || scoringMatch.data.name} (id=${scoringMatch.data.id}, confidence=${matchConfidence})`);
                    }
                  }
                }
              }
            }

            // Discover API 폴백 (웹 검색도 실패한 경우, 장르+연도로 검색)
            if (!selectedMatch && aiInference.inferredGenres && aiInference.inferredGenres.length > 0) {
              const genreIds = aiInference.inferredGenres
                .map(g => TMDB_GENRE_REVERSE_MAP[g])
                .filter((id): id is number => id !== undefined);

              if (genreIds.length > 0 && aiInference.inferredYear) {
                this.logger.log(`  [Phase 2] Discover API fallback: genres=${aiInference.inferredGenres.join(',')}, year=${aiInference.inferredYear}`);

                const discoverResults = await this.contentSearch.discoverMovies({
                  genreIds,
                  year: aiInference.inferredYear,
                  sortBy: 'popularity.desc',
                });

                for (const c of discoverResults) {
                  if (!allTmdbCandidates.find((e) => e.data.id === c.data.id)) {
                    allTmdbCandidates.push(c);
                  }
                }

                this.logger.log(`  [Discover] Found ${discoverResults.length} candidates`);
              }
            }
          }
        } catch (error) {
          const errorMessage = error instanceof AIAnalysisError
            ? error.message
            : (error as Error).message;
          this.logger.warn(`  [Phase 2] Inference analysis failed: ${errorMessage}`);
        }
      } // end of Phase 2 block

      // Phase 1 성공 시 TMDB 매칭 시도 (Phase 2 스킵된 경우)
      if (phase1Success && aiExtractedTitles.length > 0 && !selectedMatch) {
        this.logger.log(`  [Phase 1] Attempting TMDB match with extracted title: ${aiExtractedTitles.join(', ')}`);

        // Phase 1 미디어 타입 힌트 활용
        const aiInference: AIInferenceInfo = {
          inferredYear: null,
          inferredGenres: [],
          mediaTypeHint: phase1MediaTypeHint || mediaTypeHint,
        };

        selectedMatch = await this.matchFromTitles(aiExtractedTitles, allTmdbCandidates, videoInfo.description, 'phase1', aiInference, videoId, videoInfo.title);
        if (selectedMatch) {
          matchConfidence = 90; // Phase 1 직접 추출 제목 매칭 = 높은 신뢰도
          this.logger.log(`  [MATCH] Phase 1 -> ${selectedMatch.data.title || selectedMatch.data.name} (id=${selectedMatch.data.id}, confidence=${matchConfidence})`);
        }

        // Phase 1 추출 성공했지만 TMDB에서 못 찾은 경우 웹 검색 폴백
        // 유튜버가 제목을 잘못 발음하거나 AI가 오타를 낸 경우 대응
        if (!selectedMatch && allTmdbCandidates.length === 0) {
          this.logger.log(`  [Phase 1] TMDB returned 0 results, trying web search fallback`);
          const searchQueries = aiExtractedTitles.map((t) => `${t} 영화`);
          const webExtractedTitles = await this.webSearch.searchAndExtractMovieTitles(searchQueries);

          if (webExtractedTitles.length > 0) {
            this.logger.log(`  [Web] Found titles: ${webExtractedTitles.map((t) => t.title).join(', ')}`);
            for (const extracted of webExtractedTitles) {
              const cleanedTitle = this.cleanMediaTypeSuffix(extracted.title);
              const searchTitles = [cleanedTitle];
              if (extracted.englishTitle && extracted.englishTitle !== cleanedTitle) {
                searchTitles.push(extracted.englishTitle);
              }

              const webTmdbCandidates = await this.searchTMDBCandidatesParallel(searchTitles, '', extracted.year?.toString());
              for (const c of webTmdbCandidates) {
                if (!allTmdbCandidates.find((e) => e.data.id === c.data.id)) {
                  allTmdbCandidates.push(c);
                }
              }

              const webMatch = this.findHighConfidenceMatch(webTmdbCandidates, searchTitles);
              if (webMatch) {
                selectedMatch = webMatch;
                matchConfidence = 80;
                this.logger.log(`  [MATCH] Phase 1 web fallback -> ${webMatch.data.title || webMatch.data.name} (id=${webMatch.data.id})`);
                break;
              }

              if (webTmdbCandidates.length > 0) {
                const scoringMatch = this.primaryVideoSelectionService.selectBestCandidate(
                  webTmdbCandidates,
                  searchTitles,
                  videoInfo.description,
                  aiInference,
                );
                if (scoringMatch) {
                  selectedMatch = scoringMatch;
                  matchConfidence = 70;
                  this.logger.log(`  [MATCH] Phase 1 web scoring -> ${scoringMatch.data.title || scoringMatch.data.name} (id=${scoringMatch.data.id})`);
                  break;
                }
              }
            }
          }
        }
      }

      // 2. YouTube 제목 후보 폴백 (AI 매칭 실패 시)
      if (!selectedMatch) {
        const titleCandidates = this.titleExtractionService.extractCandidates(
          videoInfo.title,
          videoInfo.description,
        );
        this.logger.log(`  [Step 2] YouTube title fallback: ${titleCandidates.join(', ')}`);

        const ytTmdbCandidates = await this.searchTMDBCandidatesParallel(titleCandidates, videoInfo.description);
        for (const c of ytTmdbCandidates) {
          if (!allTmdbCandidates.find((e) => e.data.id === c.data.id)) {
            allTmdbCandidates.push(c);
          }
        }

        // 고신뢰도 매칭
        selectedMatch = this.findHighConfidenceMatch(ytTmdbCandidates, titleCandidates);
        if (selectedMatch) {
          matchConfidence = 60; // YouTube 제목 고신뢰도 매칭 = 중간 신뢰도
          this.logger.log(`  [MATCH] YT high confidence → ${selectedMatch.data.title || selectedMatch.data.name} (id=${selectedMatch.data.id}, path=yt-high-confidence)`);
        }

        // Scoring fallback (AI 추출 제목 + 추론 제목 + 영어 원제 + YouTube 제목 합산)
        if (!selectedMatch && allTmdbCandidates.length > 0) {
          const combinedTitles = [
            ...aiExtractedTitles,
            ...aiInferredTitles,
            ...aiEnglishTitles,
            ...titleCandidates,
          ].filter((t, i, arr): t is string =>
            typeof t === 'string' && t.length > 0 && arr.indexOf(t) === i,
          );

          // Phase 1 mediaType 힌트로 스코어링
          const scoringInference: AIInferenceInfo = {
            inferredYear: null,
            inferredGenres: [],
            mediaTypeHint: phase1MediaTypeHint || mediaTypeHint,
          };

          const scores = this.primaryVideoSelectionService.getCandidateScores(
            allTmdbCandidates,
            combinedTitles,
            videoInfo.description,
            scoringInference,
          );
          this.logger.log(`  [Step 3] Scoring fallback (${scores.length} candidates):`);
          scores
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .forEach(({ candidate, score }) => {
              const name = candidate.data.title || candidate.data.name;
              this.logger.log(`    → ${name} (id=${candidate.data.id}, score=${score})`);
            });

          const scoringMatch = this.primaryVideoSelectionService.selectBestCandidate(
            allTmdbCandidates,
            combinedTitles,
            videoInfo.description,
            scoringInference,
          );

          // AI 제목이 TMDB에서 결과를 찾았는지 확인
          const aiTitlesFoundMatch = allTmdbCandidates.some((c) =>
            c.searchTerm && (
              aiExtractedTitles.includes(c.searchTerm) ||
              aiInferredTitles.includes(c.searchTerm) ||
              aiEnglishTitles.includes(c.searchTerm)
            )
          );
          // AI 제목이 없거나 TMDB에서 못 찾은 경우 → 줄거리 비교로 검증
          if (scoringMatch && !aiTitlesFoundMatch && allTmdbCandidates.length >= 2) {
            this.logger.log(`  [Step 3.5] No AI titles, validating with plot comparison...`);
            const plotMatch = await this.findBestMatchByPlotComparison(videoId, allTmdbCandidates, videoInfo.title, videoInfo.description);
            if (plotMatch && plotMatch.data.id !== scoringMatch.data.id) {
              this.logger.log(`  [Verify] Plot suggests different movie: ${plotMatch.data.title || plotMatch.data.name} (id=${plotMatch.data.id})`);
              selectedMatch = plotMatch;
              matchConfidence = 40; // 줄거리 비교로 다른 영화 선택 = 낮은 신뢰도
            } else if (plotMatch) {
              this.logger.log(`  [Verify] Plot confirms: ${scoringMatch.data.title || scoringMatch.data.name}`);
              selectedMatch = scoringMatch;
              matchConfidence = 55; // 줄거리로 확인된 스코어링 = 중간 신뢰도
            } else {
              selectedMatch = scoringMatch;
              matchConfidence = 50; // 스코어링만 = 낮은 신뢰도
            }
          } else {
            selectedMatch = scoringMatch;
            if (selectedMatch) {
              matchConfidence = 55; // 스코어링 폴백
            }
          }

          if (selectedMatch) {
            this.logger.log(`  [MATCH] Scoring → ${selectedMatch.data.title || selectedMatch.data.name} (id=${selectedMatch.data.id}, path=scoring-fallback, confidence=${matchConfidence})`);
          }
        }

        // Step 4: 줄거리 비교 폴백 (Scoring 실패 시, 후보가 2개 이상일 때)
        if (!selectedMatch && allTmdbCandidates.length >= 2) {
          this.logger.log(`  [Step 4] Plot comparison fallback...`);
          selectedMatch = await this.findBestMatchByPlotComparison(videoId, allTmdbCandidates, videoInfo.title, videoInfo.description);
          if (selectedMatch) {
            matchConfidence = 40; // 줄거리 비교만 = 낮은 신뢰도
            this.logger.log(`  [MATCH] Plot comparison → ${selectedMatch.data.title || selectedMatch.data.name} (id=${selectedMatch.data.id}, path=plot-comparison, confidence=${matchConfidence})`);
          }
        }
      }

      if (!selectedMatch) {
        if (allTmdbCandidates.length === 0) {
          return {
            success: false,
            message: MESSAGES.TMDB.MATCH_FAILED_NO_RESULTS,
          };
        }
        this.logger.log(`  [RESULT] 매칭 실패 - 최소 점수 미달`);
        return {
          success: false,
          message: 'TMDB 매칭 실패 - 충분한 유사도의 후보 없음',
        };
      }

      const tmdbData = selectedMatch.data;
      const tmdbTitle = selectedMatch.type === 'movie' ? tmdbData.title : tmdbData.name;

      // 최종 신뢰도 및 상태 결정
      const videoStatus: VideoStatus = matchConfidence >= 60 ? 'pending' : 'low_confidence';
      this.logger.log(`  [RESULT] Selected: ${tmdbTitle} (${selectedMatch.type}, id=${tmdbData.id}, confidence=${matchConfidence}, status=${videoStatus})`);

      // 포스터 이미지 없으면 실패 처리
      if (!tmdbData.posterPath) {
        this.logger.warn(`  [RESULT] No poster image for: ${tmdbTitle}`);
        return {
          success: false,
          message: 'TMDB 매칭 실패 - 포스터 이미지 없음',
        };
      }

      // 5. 상세 정보 조회 (tagline) + 타이틀 로고 (병렬)
      const [details, titleLogo] = await Promise.all([
        this.contentSearch.getDetails(tmdbData.id, selectedMatch.type),
        this.contentSearch.getTitleLogo(tmdbData.id, selectedMatch.type),
      ]);

      // 6. 채널 정보 저장 (새 채널이면 메타데이터 가져오기)
      const channelId = await this.getOrCreateChannelWithMetadata(
        videoInfo.channelId,
        videoInfo.channelTitle,
      );

      const releaseDate = selectedMatch.type === 'movie'
        ? tmdbData.releaseDate
        : tmdbData.firstAirDate;

      const content = Content.create({
        id: tmdbData.id,
        contentType: selectedMatch.type,
        title: tmdbTitle || '',
        posterPath: tmdbData.posterPath,
        backdropPath: tmdbData.backdropPath,
        releaseDate,
        genreIds: details.genreIds || tmdbData.genreIds,
        originalLanguage: tmdbData.originalLanguage,
        tagline: details.tagline,
        overview: details.overview,
        uploadedAt: new Date().toISOString(),
        // AI 분석용 메타데이터
        voteAverage: details.voteAverage,
        popularity: details.popularity,
        originCountry: details.originCountry,
        directors: details.directors,
        mainCast: details.mainCast,
        // 타이틀 로고
        titleLogo: titleLogo.path || undefined,
        titleLogoLang: titleLogo.lang || undefined,
      });

      // 콘텐츠 저장 전 기존 존재 여부 확인 (롤백 판단용)
      const existingContent = await this.contentRepository.findById(TMDBId.fromNumber(tmdbData.id));
      const isNewContent = !existingContent;

      const contentId = await this.contentRepository.save(content);

      const newVideoRuntime = videoInfo.duration; // 초 단위 그대로 저장
      const existingVideos = await this.videoRepository.findByContentId(
        TMDBId.fromNumber(contentId),
      );

      const isPrimary = await this.determinePrimaryStatus(
        existingVideos,
        includesEnding,
        newVideoRuntime,
      );

      const video = Video.create({
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
        youtubeViewCount: videoInfo.viewCount,
        youtubeLikeCount: videoInfo.likeCount,
        status: videoStatus,
      });

      // 비디오 저장 (실패 시 새로 생성된 콘텐츠 롤백)
      try {
        await this.videoRepository.save(video);
      } catch (videoSaveError) {
        this.logger.error(`Video save failed: ${(videoSaveError as Error).message}`);
        if (isNewContent) {
          this.logger.warn(`Rolling back newly created content: ${contentId}`);
          try {
            await this.contentRepository.delete(TMDBId.fromNumber(contentId));
          } catch (rollbackError) {
            this.logger.error(`Failed to rollback content: ${(rollbackError as Error).message}`);
          }
        }
        throw videoSaveError;
      }

      this.logger.log(`  Saved: ${videoInfo.title} → ${tmdbTitle}`);

      return {
        success: true,
        message: '동영상 등록 완료',
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
      this.logger.error(`  Registration failed: ${(error as Error).message}`);
      return {
        success: false,
        message: `등록 실패: ${(error as Error).message}`,
      };
    }
  }

  /**
   * 제목 목록으로 TMDB 검색 → 고신뢰도/스코어링/단일결과 매칭 시도
   */
  private async matchFromTitles(
    titles: string[],
    allTmdbCandidates: TMDBMatchResult[],
    description: string,
    pathPrefix: string,
    aiInference?: AIInferenceInfo,
    videoId?: string,
    videoTitle?: string,
  ): Promise<TMDBMatchResult | null> {
    // 괄호 안 원제를 별도 제목으로 분리: "한국제목 (Original)" → ["한국제목", "Original"]
    const expandedTitles = this.expandParenthesizedTitles(titles);
    let tmdbCandidates = await this.searchTMDBCandidatesParallel(expandedTitles.slice(0, 5));

    // 검색 결과 0건이고 영어 제목인 경우, 고유명사 키워드로 재검색
    if (tmdbCandidates.length === 0) {
      const englishTitles = titles.filter((t) => /[A-Za-z]{3,}/.test(t));
      if (englishTitles.length > 0) {
        const allProperNouns: string[] = [];
        for (const title of englishTitles) {
          const properNouns = this.extractProperNouns(title);
          for (const noun of properNouns) {
            if (!allProperNouns.includes(noun)) {
              allProperNouns.push(noun);
            }
          }
        }

        if (allProperNouns.length > 0) {
          this.logger.log(`  [${pathPrefix}] No results, retrying with proper nouns: ${allProperNouns.join(', ')}`);
          tmdbCandidates = await this.searchTMDBCandidatesParallel(allProperNouns.slice(0, 3));
        }
      }
    }

    if (tmdbCandidates.length === 0) return null;

    // 중복 제거하며 전체 목록에 추가
    for (const c of tmdbCandidates) {
      if (!allTmdbCandidates.find((e) => e.data.id === c.data.id)) {
        allTmdbCandidates.push(c);
      }
    }

    // 고신뢰도 매칭
    let match = this.findHighConfidenceMatch(tmdbCandidates, titles);
    if (match) {
      // 유사 제목 검증: 추출된 제목이 다른 후보의 부분 문자열인 경우 줄거리 비교
      const verifiedMatch = await this.verifySimilarTitles(
        match,
        tmdbCandidates,
        titles,
        videoId,
        description,
      );
      if (verifiedMatch && verifiedMatch.data.id !== match.data.id) {
        this.logger.log(`  [VERIFY] Similar title check suggests: ${verifiedMatch.data.title || verifiedMatch.data.name} (id=${verifiedMatch.data.id})`);
        return verifiedMatch;
      }
      this.logger.log(`  [MATCH] ${pathPrefix} high confidence → ${match.data.title || match.data.name} (id=${match.data.id}, path=${pathPrefix}-high-confidence)`);
      return match;
    }

    // 동일/유사 제목 다수 후보 체크: 유사한 한글 제목이 여러 개면 줄거리 비교 필요
    // "위대한 유산" 같은 동명의 다른 영화들 구분을 위함
    const titleToMatch = titles[0]?.toLowerCase();
    if (titleToMatch && videoId) {
      const similarTitleCandidates = tmdbCandidates.filter((c) => {
        const koreanTitle = (c.data.title || c.data.name || '').toLowerCase();
        // 정확 일치 또는 높은 유사도(0.85 이상) 체크
        if (koreanTitle === titleToMatch) return true;
        if (koreanTitle.length >= 2 && titleToMatch.length >= 2) {
          const similarity = compareTwoStrings(koreanTitle, titleToMatch);
          return similarity >= 0.85;
        }
        return false;
      });

      this.logger.log(`  [DEBUG] Similar title candidates: ${similarTitleCandidates.length} for "${titleToMatch}"`);
      similarTitleCandidates.forEach((c) => {
        this.logger.log(`    - ${c.data.title || c.data.name} (id=${c.data.id})`);
      });

      if (similarTitleCandidates.length >= 2) {
        this.logger.log(`  [VERIFY] Found ${similarTitleCandidates.length} candidates with similar title "${titleToMatch}", using disambiguation`);

        // YouTube 영상 제목에서 따옴표 안 텍스트 추출 (핵심 키워드)
        // 예: "징벌적 손해 배상" from '미쳐버린 짜릿함이 느껴지는 "징벌적 손해 배상"'
        const titleForKeyword = videoTitle || '';
        const quotedMatch = titleForKeyword.match(/['""'](.*?)['""']/);
        const keywordHint = quotedMatch ? quotedMatch[1] : null;
        this.logger.log(`  [VERIFY] Video title: "${titleForKeyword}", keyword hint: ${keywordHint || 'none'}`);

        // 웹 검색으로 정확한 영화 찾기 (키워드 힌트 활용)
        if (keywordHint && keywordHint.length >= 3) {
          this.logger.log(`  [VERIFY] Using keyword hint "${keywordHint}" for web search disambiguation`);
          const searchQueries = [`${keywordHint} 영화`, `${keywordHint} ${titleToMatch}`];
          const webResults = await this.webSearch.searchAndExtractMovieTitles(searchQueries);

          if (webResults.length > 0) {
            this.logger.log(`  [VERIFY] Web search found: ${webResults.map(r => r.title).join(', ')}`);
            // 웹 검색 결과의 영어 제목으로 후보 매칭
            for (const webResult of webResults) {
              if (webResult.englishTitle) {
                const englishLower = webResult.englishTitle.toLowerCase();
                for (const candidate of similarTitleCandidates) {
                  const origTitle = (candidate.data.originalTitle || candidate.data.originalName || '').toLowerCase();
                  if (origTitle && compareTwoStrings(origTitle, englishLower) >= 0.7) {
                    this.logger.log(`  [MATCH] ${pathPrefix} web verified → ${candidate.data.title || candidate.data.name} (id=${candidate.data.id}, english=${origTitle})`);
                    return candidate;
                  }
                }
              }
            }
          }
        }

        // 미디어 타입 힌트로 후보 필터링 (movie vs tv 구분)
        if (aiInference?.mediaTypeHint) {
          const mediaTypeMatches = similarTitleCandidates.filter((c) => c.type === aiInference.mediaTypeHint);
          this.logger.log(`  [VERIFY] MediaType hint "${aiInference.mediaTypeHint}" matches: ${mediaTypeMatches.length} candidates`);

          if (mediaTypeMatches.length === 1) {
            // 미디어 타입이 일치하는 후보가 하나뿐이면 바로 선택
            this.logger.log(`  [MATCH] ${pathPrefix} mediaType match → ${mediaTypeMatches[0].data.title || mediaTypeMatches[0].data.name} (id=${mediaTypeMatches[0].data.id})`);
            return mediaTypeMatches[0];
          }

          if (mediaTypeMatches.length > 1) {
            // 여러 개 일치하면 그 중에서 플롯 비교
            this.logger.log(`  [VERIFY] Multiple mediaType matches, using plot comparison among them`);
            const plotMatch = await this.findBestMatchByPlotComparison(videoId, mediaTypeMatches, undefined, description);
            if (plotMatch) {
              this.logger.log(`  [MATCH] ${pathPrefix} plot+mediaType → ${plotMatch.data.title || plotMatch.data.name} (id=${plotMatch.data.id})`);
              return plotMatch;
            }

            // 플롯 비교 실패 시 인기도 + 최신 콘텐츠 선호 (동명이인 구분)
            const currentYear = new Date().getFullYear();
            const sortedByScore = [...mediaTypeMatches].sort((a, b) => {
              const dateA = a.data.releaseDate || a.data.firstAirDate || '';
              const dateB = b.data.releaseDate || b.data.firstAirDate || '';
              const yearA = dateA ? parseInt(dateA.split('-')[0], 10) : 0;
              const yearB = dateB ? parseInt(dateB.split('-')[0], 10) : 0;
              const ageA = yearA ? currentYear - yearA : 100;
              const ageB = yearB ? currentYear - yearB : 100;
              const popA = a.data.popularity || 0;
              const popB = b.data.popularity || 0;

              // 오래된 콘텐츠(50년 이상) 페널티
              const penaltyA = ageA >= 50 ? -100 : 0;
              const penaltyB = ageB >= 50 ? -100 : 0;

              // 인기도 + 최신 순 + 오래된 콘텐츠 페널티
              const scoreA = popA + (100 - ageA) * 0.1 + penaltyA;
              const scoreB = popB + (100 - ageB) * 0.1 + penaltyB;
              return scoreB - scoreA;
            });
            const selected = sortedByScore[0];
            this.logger.log(`  [MATCH] ${pathPrefix} mediaType+popularity → ${selected.data.title || selected.data.name} (id=${selected.data.id}, pop=${selected.data.popularity?.toFixed(1)})`);
            return selected;
          }
        }

        // 미디어 타입 힌트 없거나 불일치 시 플롯 비교 폴백
        const plotMatch = await this.findBestMatchByPlotComparison(videoId, similarTitleCandidates, undefined, description);
        if (plotMatch) {
          this.logger.log(`  [MATCH] ${pathPrefix} plot comparison → ${plotMatch.data.title || plotMatch.data.name} (id=${plotMatch.data.id})`);
          return plotMatch;
        }

        // 플롯 비교 실패 시 인기도 + 최신 콘텐츠 기준 선택
        if (similarTitleCandidates.length >= 2) {
          const currentYear = new Date().getFullYear();
          const sortedByScore = [...similarTitleCandidates].sort((a, b) => {
            const dateA = a.data.releaseDate || a.data.firstAirDate || '';
            const dateB = b.data.releaseDate || b.data.firstAirDate || '';
            const yearA = dateA ? parseInt(dateA.split('-')[0], 10) : 0;
            const yearB = dateB ? parseInt(dateB.split('-')[0], 10) : 0;
            const ageA = yearA ? currentYear - yearA : 100;
            const ageB = yearB ? currentYear - yearB : 100;
            const popA = a.data.popularity || 0;
            const popB = b.data.popularity || 0;

            // 오래된 콘텐츠(50년 이상) 페널티
            const penaltyA = ageA >= 50 ? -100 : 0;
            const penaltyB = ageB >= 50 ? -100 : 0;

            // 인기도 + 최신 순 + 오래된 콘텐츠 페널티
            const scoreA = popA + (100 - ageA) * 0.1 + penaltyA;
            const scoreB = popB + (100 - ageB) * 0.1 + penaltyB;
            return scoreB - scoreA;
          });
          const selected = sortedByScore[0];
          this.logger.log(`  [MATCH] ${pathPrefix} popularity fallback → ${selected.data.title || selected.data.name} (id=${selected.data.id}, pop=${selected.data.popularity?.toFixed(1)})`);
          return selected;
        }
      }
    }

    // 스코어링 매칭 (AI 추론 장르/연도 가중치 적용)
    match = this.primaryVideoSelectionService.selectBestCandidate(tmdbCandidates, titles, description, aiInference);
    if (match) {
      // 유사 제목 검증: 스코어링 매칭도 유사 제목 체크 (트래픽 vs 트래픽트 케이스)
      const verifiedMatch = await this.verifySimilarTitles(
        match,
        tmdbCandidates,
        titles,
        videoId,
        description,
      );
      if (verifiedMatch && verifiedMatch.data.id !== match.data.id) {
        this.logger.log(`  [VERIFY] Similar title check (scoring) suggests: ${verifiedMatch.data.title || verifiedMatch.data.name} (id=${verifiedMatch.data.id})`);
        return verifiedMatch;
      }
      this.logger.log(`  [MATCH] ${pathPrefix} scoring → ${match.data.title || match.data.name} (id=${match.data.id}, path=${pathPrefix}-extracted)`);
      return match;
    }

    // 단일 결과 신뢰 (AI 추론 제목은 유사도 검증 필수)
    if (tmdbCandidates.length === 1) {
      match = tmdbCandidates[0];
      const isInferredPath = pathPrefix.includes('inferred');

      if (isInferredPath) {
        // AI 추론 제목: 유사도 검증 필수 (환각 방지)
        const tmdbTitle = (match.data.title || match.data.name || '').toLowerCase();
        const tmdbOriginalTitle = (match.data.originalTitle || match.data.originalName || '').toLowerCase();
        let bestSimilarity = 0;

        for (const title of titles) {
          const normalized = title.toLowerCase().trim();
          const simTitle = compareTwoStrings(normalized, tmdbTitle);
          const simOriginal = tmdbOriginalTitle ? compareTwoStrings(normalized, tmdbOriginalTitle) : 0;
          bestSimilarity = Math.max(bestSimilarity, simTitle, simOriginal);
        }

        // AI 추론 단일 결과는 유사도 0.6 이상 필요
        if (bestSimilarity >= 0.6) {
          this.logger.log(`  [MATCH] ${pathPrefix} single result (verified, sim=${bestSimilarity.toFixed(2)}) → ${match.data.title || match.data.name} (id=${match.data.id}, path=${pathPrefix}-single)`);
          return match;
        } else {
          this.logger.log(`  [SKIP] ${pathPrefix} single result rejected (sim=${bestSimilarity.toFixed(2)} < 0.6) → ${match.data.title || match.data.name}`);
          return null;
        }
      }

      // 직접 추출 제목: 기존대로 단일 결과 신뢰
      this.logger.log(`  [MATCH] ${pathPrefix} single result (trusted) → ${match.data.title || match.data.name} (id=${match.data.id}, path=${pathPrefix}-single)`);
      return match;
    }

    return null;
  }

  /**
   * 유사 제목 검증
   * 추출된 제목이 다른 TMDB 후보의 부분 문자열인 경우 줄거리 비교로 검증
   * 예: "트래픽"(추출) vs "트래픽트"(TMDB) - 줄거리 비교로 진짜 후보 선택
   */
  private async verifySimilarTitles(
    currentMatch: TMDBMatchResult,
    candidates: TMDBMatchResult[],
    extractedTitles: string[],
    videoId?: string,
    description?: string,
  ): Promise<TMDBMatchResult | null> {
    if (candidates.length < 2 || !videoId) {
      return null;
    }

    const currentTitle = (currentMatch.data.title || currentMatch.data.name || '').toLowerCase();

    // 유사 제목 후보 찾기: 추출된 제목이 다른 후보 제목의 prefix/substring인 경우
    const similarCandidates = candidates.filter((c) => {
      if (c.data.id === currentMatch.data.id) return false;

      const otherTitle = (c.data.title || c.data.name || '').toLowerCase();
      const otherOriginal = (c.data.originalTitle || c.data.originalName || '').toLowerCase();

      // 현재 매칭된 제목이 다른 제목의 prefix인지 확인
      // 예: "트래픽" vs "트래픽트", "인셉션" vs "인셉션2"
      const isPrefixMatch =
        (otherTitle.startsWith(currentTitle) && otherTitle !== currentTitle) ||
        (otherOriginal.startsWith(currentTitle) && otherOriginal !== currentTitle);

      // 추출된 제목 중 하나가 다른 후보의 prefix인지 확인
      const extractedIsPrefix = extractedTitles.some((ext) => {
        const extLower = ext.toLowerCase();
        return (otherTitle.startsWith(extLower) && otherTitle !== extLower) ||
               (otherOriginal.startsWith(extLower) && otherOriginal !== extLower);
      });

      return isPrefixMatch || extractedIsPrefix;
    });

    if (similarCandidates.length === 0) {
      return null;
    }

    this.logger.log(`  [VERIFY] Found ${similarCandidates.length} similar title candidates, running plot comparison`);

    // 현재 매칭 + 유사 후보들로 줄거리 비교
    const candidatesForComparison = [currentMatch, ...similarCandidates];

    try {
      const plotMatch = await this.findBestMatchByPlotComparison(
        videoId,
        candidatesForComparison,
        undefined,
        description,
      );

      // 줄거리 비교가 결과를 반환하면 사용
      if (plotMatch) {
        return plotMatch;
      }

      // 줄거리 비교 실패 시 (overview 없는 경우 등) TMDB 검색 순서 고려
      // TMDB는 더 관련성 높은 결과를 먼저 반환하므로, 추출 제목이 prefix인 더 긴 제목이
      // 먼저 반환되었다면 그것이 실제 의도한 콘텐츠일 가능성이 높음
      for (const similar of similarCandidates) {
        const similarIndex = candidates.indexOf(similar);
        const currentIndex = candidates.indexOf(currentMatch);

        // 유사 후보가 현재 매칭보다 TMDB 결과에서 앞에 있으면 선택
        if (similarIndex !== -1 && currentIndex !== -1 && similarIndex < currentIndex) {
          this.logger.log(`  [VERIFY] Preferring "${similar.data.title || similar.data.name}" (id=${similar.data.id}) - appears before "${currentTitle}" in TMDB results`);
          return similar;
        }
      }

      return null;
    } catch (error) {
      this.logger.warn(`  [VERIFY] Plot comparison failed: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * TMDB 병렬 검색
   * 순차 호출 → Promise.all 병렬 호출로 변경
   */
  private async searchTMDBCandidatesParallel(
    titleCandidates: string[],
    description?: string,
    explicitYear?: string,
  ): Promise<TMDBMatchResult[]> {
    const validCandidates = titleCandidates
      .slice(0, TMDB_CONFIG.MAX_CANDIDATES)
      .filter((c) => c.length >= TMDB_CONFIG.MIN_TITLE_LENGTH && c.length <= TMDB_CONFIG.MAX_TITLE_LENGTH);

    if (validCandidates.length === 0) {
      return [];
    }

    // 연도 힌트 추출 (명시적 연도 > 제목/설명에서 추출)
    const yearHint = explicitYear || this.extractYearHint(validCandidates, description);

    // 검색 쿼리 변형 생성 (한국어+숫자 공백 정규화)
    const searchQueries = this.expandSearchQueries(validCandidates);

    // 병렬로 모든 검색 실행
    const searchPromises = searchQueries.map(async (candidate) => {
      try {
        const results = await this.contentSearch.searchMulti(candidate, yearHint || undefined);
        return { candidate, results, error: null };
      } catch (err) {
        return { candidate, results: [], error: err };
      }
    });

    const searchResults = await Promise.all(searchPromises);

    // 결과 병합 (중복 제거)
    const tmdbCandidates: TMDBMatchResult[] = [];
    const searchSummary: string[] = [];

    for (const { candidate, results, error } of searchResults) {
      if (error) {
        searchSummary.push(`${candidate}:ERR`);
        continue;
      }
      searchSummary.push(`${candidate}:${results.length}`);
      for (const result of results) {
        if (!tmdbCandidates.find((c) => c.data.id === result.data.id)) {
          tmdbCandidates.push({
            type: result.type,
            data: result.data,
            confidence: 0,
            searchTerm: candidate,
          });
        }
      }
    }

    this.logger.log(
      `  Found ${tmdbCandidates.length} TMDB candidates (${searchSummary.join(', ')})`,
    );

    return tmdbCandidates;
  }

  /**
   * 고신뢰도 매칭 찾기
   * 조건: Dice 유사도 ≥ 0.95 + 높은 인기도 + 경쟁 후보 없음
   * 이 조건을 만족하면 AI 호출 스킵 가능
   */
  private findHighConfidenceMatch(
    tmdbCandidates: TMDBMatchResult[],
    titleCandidates: string[],
  ): TMDBMatchResult | null {
    if (tmdbCandidates.length === 0) {
      return null;
    }

    // 유효한 제목 후보만 필터 (3자 이상)
    const validTitles = titleCandidates.filter((t) => t.trim().length >= 3);
    if (validTitles.length === 0) {
      return null;
    }

    // 각 후보의 최고 유사도 계산
    const scored = tmdbCandidates.map((candidate) => {
      const tmdbTitle = (candidate.data.title || candidate.data.name || '').toLowerCase();
      const tmdbOriginalTitle = (candidate.data.originalTitle || candidate.data.originalName || '').toLowerCase();
      const titlesToCompare = [tmdbTitle, tmdbOriginalTitle].filter((t) => t.length > 0);

      let bestSimilarity = 0;
      for (const title of validTitles) {
        const normalized = title.toLowerCase().trim();
        for (const tmdb of titlesToCompare) {
          const similarity = compareTwoStrings(normalized, tmdb);
          bestSimilarity = Math.max(bestSimilarity, similarity);
        }
      }

      return { candidate, similarity: bestSimilarity };
    });

    // 유사도 내림차순 정렬
    scored.sort((a, b) => b.similarity - a.similarity);

    const best = scored[0];

    // 최고 유사도가 0.95 미만이면 고신뢰 아님
    if (best.similarity < 0.95) {
      return null;
    }

    // 경쟁 후보 체크: 2번째 후보의 유사도가 0.7 이상이면 애매하므로 AI에 위임
    if (scored.length >= 2 && scored[1].similarity >= 0.7) {
      return null;
    }

    // 인기도 체크
    const popularity = best.candidate.data.popularity || 0;
    if (popularity < TMDB_CONFIG.MIN_POPULARITY_THRESHOLD) {
      return null;
    }

    return best.candidate;
  }

  /**
   * 괄호 안 원제를 별도 제목으로 분리
   * "늑대의 살 아래 (La piel que habito)" → ["늑대의 살 아래", "La piel que habito"]
   */
  private expandParenthesizedTitles(titles: string[]): string[] {
    const expanded: string[] = [];
    for (const title of titles) {
      const match = title.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (match) {
        const main = match[1].trim();
        const inner = match[2].trim();
        if (main.length >= 2) expanded.push(main);
        if (inner.length >= 2) expanded.push(inner);
      } else {
        expanded.push(title);
      }
    }
    return expanded.filter((t, i, arr) => arr.indexOf(t) === i);
  }

  /**
   * 한국어+숫자 공백 정규화 등 검색 쿼리 변형 생성
   * "조폭 마누라2" → ["조폭 마누라2", "조폭 마누라 2"]
   * "프렌즈 앤 네이버스" → ["프렌즈 앤 네이버스", "프렌즈 & 네이버스"]
   */
  private expandSearchQueries(candidates: string[]): string[] {
    const expanded: string[] = [];
    for (const candidate of candidates) {
      expanded.push(candidate);

      // 한글 뒤에 바로 숫자가 오는 경우 공백 삽입 변형 추가
      const spaced = candidate.replace(/([가-힣])(\d)/g, '$1 $2');
      if (spaced !== candidate && !expanded.includes(spaced)) {
        expanded.push(spaced);
      }

      // "앤" → "&" 변환 (프렌즈 앤 네이버스 → 프렌즈 & 네이버스)
      if (candidate.includes('앤')) {
        const withAmpersand = candidate.replace(/앤/g, '&');
        if (!expanded.includes(withAmpersand)) {
          expanded.push(withAmpersand);
        }
      }
    }
    return expanded;
  }

  /**
   * 제목 후보 또는 설명에서 연도 힌트 추출
   */
  private extractYearHint(titleCandidates: string[], description?: string): string | null {
    // 제목 후보에서 연도 패턴 추출 (예: "인셉션 2010", "제목(2023)")
    for (const candidate of titleCandidates) {
      const yearMatch = candidate.match(/\(?(\d{4})\)?/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        if (year >= 1900 && year <= 2030) {
          return yearMatch[1];
        }
      }
    }

    // 설명에서 연도 패턴 추출
    if (description) {
      const descYearMatch = description.match(/\((\d{4})\)/);
      if (descYearMatch) {
        const year = parseInt(descYearMatch[1], 10);
        if (year >= 1900 && year <= 2030) {
          return descYearMatch[1];
        }
      }
    }

    return null;
  }

  private async determinePrimaryStatus(
    existingVideos: Video[],
    includesEnding: boolean,
    newVideoRuntime: number,
  ): Promise<boolean> {
    if (existingVideos.length === 0) {
      this.logger.log(`  First video for content → isPrimary: true`);
      return true;
    }

    const currentPrimary = existingVideos.find((v) => v.isPrimary);

    if (!currentPrimary) {
      this.logger.log(`  No primary video exists → isPrimary: true`);
      return true;
    }

    const newHasEnding = includesEnding;
    const currentHasEnding = currentPrimary.includesEnding;

    if (newHasEnding && !currentHasEnding) {
      await this.videoRepository.updatePrimaryStatus(currentPrimary.id, false);
      this.logger.log(`  결말포함 우선 → isPrimary: true`);
      return true;
    }

    if (!newHasEnding && currentHasEnding) {
      this.logger.log(`  기존 영상이 결말포함 → isPrimary: false`);
      return false;
    }

    const currentRuntime = currentPrimary.runtime ?? 0;
    if (newVideoRuntime > currentRuntime) {
      await this.videoRepository.updatePrimaryStatus(currentPrimary.id, false);
      this.logger.log(
        `  런타임 비교 (${newVideoRuntime}초 > ${currentRuntime}초) → isPrimary: true`,
      );
      return true;
    }

    this.logger.log(
      `  런타임 비교 (${newVideoRuntime}초 <= ${currentRuntime}초) → isPrimary: false`,
    );
    return false;
  }

  /**
   * 채널 조회 또는 생성 (메타데이터 포함)
   * 새 채널인 경우 YouTube에서 메타데이터를 가져와서 저장
   */
  private async getOrCreateChannelWithMetadata(
    channelId: string,
    channelName: string,
  ): Promise<string> {
    const exists = await this.channelRepository.exists(channelId);

    if (exists) {
      return channelId;
    }

    // 새 채널: 메타데이터 가져오기
    this.logger.log(`  New channel detected, fetching metadata: ${channelId}`);

    try {
      const metadata = await this.youtubeExtractor.getChannelMetadata(channelId);

      const channel = Channel.create({
        id: channelId,
        name: metadata.name || channelName || 'Unknown Channel',
        handleId: metadata.handleId || channelId,
        logoUrl: metadata.logoUrl,
        bannerUrl: metadata.bannerUrl,
        subscriberCount: metadata.subscriberCount,
      });

      await this.channelRepository.save(channel);
      this.logger.log(`  Channel saved: ${metadata.name} (${metadata.subscriberCount?.toLocaleString()} subscribers)`);

      return channelId;
    } catch (error) {
      this.logger.warn(`  Failed to fetch channel metadata: ${(error as Error).message}`);
      // 폴백: 기본 정보로 저장
      return this.channelRepository.getOrCreate(channelId, channelName);
    }
  }

  /**
   * YouTube 제목에서 미디어 타입 힌트 추출
   * "드라마" → 'tv', "영화" → 'movie'
   */
  private extractMediaTypeHint(youtubeTitle: string): 'tv' | 'movie' | null {
    const titleLower = youtubeTitle.toLowerCase();

    // TV 드라마 힌트
    const tvIndicators = ['드라마', '시즌', '에피소드', '최종화', '시리즈', '웹드라마', 'drama', 'series', 'season'];
    for (const indicator of tvIndicators) {
      if (titleLower.includes(indicator)) {
        this.logger.log(`  [MediaType] Detected TV hint: "${indicator}" in title`);
        return 'tv';
      }
    }

    // 영화 힌트
    const movieIndicators = ['영화', '극장판', '무비', 'movie', 'film'];
    for (const indicator of movieIndicators) {
      if (titleLower.includes(indicator)) {
        this.logger.log(`  [MediaType] Detected movie hint: "${indicator}" in title`);
        return 'movie';
      }
    }

    return null;
  }

  /**
   * 짧은 한글 제목을 로마자로 변환 (기본적인 변환)
   * 예: "루" → "Lou", "셀" → "Cell"
   */
  private romanizeKorean(korean: string): string | null {
    // 기본 한글 → 로마자 매핑 (발음 기반)
    const ROMANIZATION_MAP: Record<string, string> = {
      // 1자 제목들
      '루': 'Lou',
      '셀': 'Cell',
      '잇': 'It',
      '원': 'One',
      '썬': 'Sun',
      '런': 'Run',
      '폰': 'Phone',
      '캣': 'Cat',
      '독': 'Doc',
      '잼': 'Jam',
      '허': 'Her',
      '잡': 'Job',
      '넷': 'Net',
      '펫': 'Pet',
      '맘': 'Mom',
      '맨': 'Man',
      '선': 'Sun',
      '문': 'Moon',
      '빅': 'Big',
      '탑': 'Top',
      '라이프': 'Life',
      '조커': 'Joker',
      '덩크': 'Dunk',
      '고스트': 'Ghost',
      '히트': 'Heat',
      '키드': 'Kid',
      // 2자 제목들
      '쏘우': 'Saw',
      '키스': 'Kiss',
      '에이리언': 'Alien',
      '조스': 'Jaws',
      '테넷': 'Tenet',
    };

    return ROMANIZATION_MAP[korean] || null;
  }

  /**
   * Phase 1 미디어 타입 힌트를 TMDB API 호환 타입으로 변환
   * anime/documentary -> movie (TMDB는 movie/tv만 구분)
   */
  private convertMediaTypeHint(
    hint: 'movie' | 'tv' | 'anime' | 'documentary' | null,
  ): 'movie' | 'tv' | null {
    if (!hint) return null;
    if (hint === 'movie' || hint === 'tv') return hint;
    // anime, documentary는 movie로 처리 (TMDB API 호환성)
    return 'movie';
  }

  /**
   * 줄거리 비교를 통한 최적 TMDB 후보 선택
   * 자막 내용과 TMDB overview를 비교하여 가장 유사한 후보 반환
   */
  private async findBestMatchByPlotComparison(
    videoId: string,
    candidates: TMDBMatchResult[],
    videoTitle?: string,
    videoDescription?: string,
  ): Promise<TMDBMatchResult | null> {
    try {
      // 자막 조회
      const videoWithTranscript = await this.youtubeExtractor.getVideoInfoWithTranscript(videoId);
      let transcript = videoWithTranscript.transcript || '';

      // 자막이 부족하면 제목 + 설명으로 보완
      if (transcript.length < 500) {
        const titleDesc = [
          videoTitle || videoWithTranscript.title,
          videoDescription || videoWithTranscript.description,
        ].filter(Boolean).join(' ');
        transcript = `${transcript} ${titleDesc}`.trim();
        this.logger.log(`  [Plot] Transcript short, augmented with title/description (${transcript.length} chars)`);
      }

      if (transcript.length < 50) {
        this.logger.log(`  [Plot] Content too short (${transcript.length} chars)`);
        return null;
      }

      // 비디오 제목에서 키워드 추출 (따옴표 안 텍스트 우선)
      const actualTitle = videoTitle || videoWithTranscript.title || '';
      const quotedMatch = actualTitle.match(/['""'](.*?)['""']/);
      const titleKeywords = quotedMatch ? quotedMatch[1] : actualTitle;

      // 각 후보의 overview와 비교 (자막 + 제목 키워드 복합 점수)
      const MIN_PLOT_SIMILARITY = 0.10; // 임계값 낮춤 (0.15 → 0.10)
      const scored = candidates
        .filter((c) => c.data.overview && c.data.overview.length > 20)
        .map((candidate) => {
          // 자막-줄거리 유사도
          const transcriptSimilarity = comparePlotContent(transcript, candidate.data.overview);
          // 제목 키워드-줄거리 유사도 (보조 지표)
          const titleSimilarity = titleKeywords.length > 3
            ? comparePlotContent(titleKeywords, candidate.data.overview)
            : 0;
          // 복합 점수: 자막 80% + 제목 20% 가중치
          const similarity = transcriptSimilarity * 0.8 + titleSimilarity * 0.2;
          return { candidate, similarity, transcriptSimilarity, titleSimilarity };
        });

      if (scored.length === 0) {
        this.logger.log(`  [Plot] No candidates with valid overview`);
        return null;
      }

      // 유사도 내림차순 정렬
      scored.sort((a, b) => b.similarity - a.similarity);

      // 상위 3개 후보 로그
      this.logger.log(`  [Plot] Similarity scores (title keywords: "${titleKeywords}"):`);
      scored.slice(0, 3).forEach(({ candidate, similarity, transcriptSimilarity, titleSimilarity }) => {
        const name = candidate.data.title || candidate.data.name;
        this.logger.log(`    → ${name} (id=${candidate.data.id}, combined=${(similarity * 100).toFixed(1)}%, transcript=${(transcriptSimilarity * 100).toFixed(1)}%, title=${(titleSimilarity * 100).toFixed(1)}%)`);
      });

      const best = scored[0];

      // 최소 유사도 체크
      if (best.similarity < MIN_PLOT_SIMILARITY) {
        this.logger.log(`  [Plot] Best similarity ${(best.similarity * 100).toFixed(1)}% < ${MIN_PLOT_SIMILARITY * 100}% threshold`);
        return null;
      }

      // 2위와의 차이가 충분한지 확인
      if (scored.length >= 2) {
        const secondBest = scored[1];
        const gap = best.similarity - secondBest.similarity;

        // 차이가 작으면 인기도/연도로 구분 시도
        if (gap < 0.05) {
          const bestPop = best.candidate.data.popularity || 0;
          const secondPop = secondBest.candidate.data.popularity || 0;
          const currentYear = new Date().getFullYear();

          // 연도 정보 추출
          const bestYear = best.candidate.data.releaseDate || best.candidate.data.firstAirDate;
          const secondYear = secondBest.candidate.data.releaseDate || secondBest.candidate.data.firstAirDate;
          const bestAge = bestYear ? currentYear - parseInt(bestYear.split('-')[0], 10) : 0;
          const secondAge = secondYear ? currentYear - parseInt(secondYear.split('-')[0], 10) : 0;

          this.logger.log(`  [Plot] Close scores (gap=${(gap * 100).toFixed(1)}%), comparing: pop=${bestPop.toFixed(1)} vs ${secondPop.toFixed(1)}, age=${bestAge}y vs ${secondAge}y`);

          // 인기도가 5배 이상 차이나면 인기도 높은 것 선택
          if (secondPop > bestPop * 5) {
            this.logger.log(`  [Plot] Selecting by popularity: ${secondBest.candidate.data.title || secondBest.candidate.data.name}`);
            return secondBest.candidate;
          }
          if (bestPop > secondPop * 5) {
            this.logger.log(`  [Plot] Confirming by popularity: ${best.candidate.data.title || best.candidate.data.name}`);
            return best.candidate;
          }

          // 오래된 콘텐츠(50년 이상) vs 최신 콘텐츠 비교
          if (bestAge >= 50 && secondAge < 50) {
            this.logger.log(`  [Plot] Selecting newer content: ${secondBest.candidate.data.title || secondBest.candidate.data.name}`);
            return secondBest.candidate;
          }
          if (secondAge >= 50 && bestAge < 50) {
            this.logger.log(`  [Plot] Confirming newer content: ${best.candidate.data.title || best.candidate.data.name}`);
            return best.candidate;
          }
        }
      }

      return best.candidate;
    } catch (error) {
      this.logger.warn(`  [Plot] Comparison failed: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * 제목에서 미디어 타입 접미사 제거
   * "타임즈(드라마)" → "타임즈"
   * "인셉션(영화)" → "인셉션"
   */
  private cleanMediaTypeSuffix(title: string): string {
    // 괄호 안 미디어 타입 접미사 제거
    const suffixes = [
      /\(드라마\)$/i,
      /\(영화\)$/i,
      /\(애니메이션\)$/i,
      /\(애니\)$/i,
      /\(다큐멘터리\)$/i,
      /\(다큐\)$/i,
      /\(시리즈\)$/i,
      /\(미니시리즈\)$/i,
      /\(TV\)$/i,
      /\(TV 드라마\)$/i,
      /\(한국 드라마\)$/i,
      /\(K-드라마\)$/i,
    ];

    let cleaned = title.trim();
    for (const suffix of suffixes) {
      cleaned = cleaned.replace(suffix, '').trim();
    }

    return cleaned;
  }

  /**
   * 영어 제목/검색쿼리에서 고유명사(인명, 지명 등) 추출
   * 예: "The Murdaugh Murders: A Southern Scandal" → ["Murdaugh", "Southern"]
   * 예: "Murdaugh family scandal documentary" → ["Murdaugh"]
   */
  private extractProperNouns(text: string): string[] {
    // 일반적인 불용어 (관사, 전치사, 일반 명사 등)
    const stopWords = new Set([
      // 관사/전치사
      'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as',
      // 일반 명사 (영화/드라마 관련)
      'movie', 'film', 'drama', 'series', 'show', 'documentary', 'season', 'episode',
      'story', 'tale', 'saga', 'chronicles', 'murders', 'murder', 'death', 'killer',
      'family', 'scandal', 'mystery', 'crime', 'thriller', 'horror', 'action', 'romance',
      'review', 'trailer', 'official', 'full', 'complete', 'ending', 'explained',
      // 지역/국가 일반어
      'korean', 'american', 'british', 'japanese', 'chinese', 'hollywood', 'netflix',
      // 기타 일반어
      'new', 'old', 'best', 'top', 'real', 'true', 'last', 'final', 'first', 'great',
    ]);

    // 단어 추출 (영어 단어만)
    const words = text.match(/[A-Za-z]+/g) || [];

    // 고유명사 추출: 대문자로 시작하고, 불용어가 아니며, 3자 이상
    const properNouns = words
      .filter((word) => {
        const lower = word.toLowerCase();
        // 불용어 제외
        if (stopWords.has(lower)) return false;
        // 3자 미만 제외
        if (word.length < 3) return false;
        // 대문자로 시작하거나, 전체 대문자이거나 (검색쿼리에서 고유명사일 가능성)
        // 또는 일반 소문자지만 불용어가 아닌 경우도 포함 (검색쿼리 키워드)
        return true;
      })
      .filter((word, index, arr) => arr.indexOf(word) === index); // 중복 제거

    // 대문자로 시작하는 단어 우선 반환 (진짜 고유명사)
    const capitalized = properNouns.filter((w) => /^[A-Z]/.test(w));
    if (capitalized.length > 0) {
      return capitalized.slice(0, 3); // 최대 3개
    }

    // 대문자 없으면 전체에서 상위 3개 (검색쿼리 키워드)
    return properNouns.slice(0, 3);
  }
}
