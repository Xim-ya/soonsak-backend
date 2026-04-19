import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Innertube } from 'youtubei.js';
import { YoutubeTranscript } from 'youtube-transcript';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  IYouTubeExtractorPort,
  YouTubeVideoInfo,
  TranscriptResult,
  ChannelVideoItem,
  ChannelMetadata,
} from '@/application/ports';
import { extractVideoId } from '@/shared/utils';

const execAsync = promisify(exec);

/** 429 에러 재시도 설정 (강화) */
const RATE_LIMIT_RETRY_CONFIG = {
  maxRetries: 3,        // 5회 → 3회 (빠른 실패)
  baseDelayMs: 10000,   // 15초 → 10초
  maxDelayMs: 30000,    // 120초 → 30초 (빠른 포기)
};

/** 선제적 요청 간 딜레이 (rate limit 방지) */
const PROACTIVE_DELAY_MS = 5000;

/** Circuit Breaker 설정 */
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 3,        // 연속 3회 실패 시 circuit open
  cooldownMs: 10 * 60 * 1000, // 10분 쿨다운
};

/** yt-dlp Rate Limit 방지 옵션 */
const YT_DLP_RATE_LIMIT_OPTIONS = [
  '--sleep-requests 3',       // 요청 간 3초 대기
  '--sleep-interval 5',       // 다운로드 간 최소 5초
  '--max-sleep-interval 15',  // 최대 15초 (랜덤)
  '--sleep-subtitles 2',      // 자막 요청 전 2초 대기
].join(' ');

/** 쿠키 파일 경로 */
const COOKIES_FILE_PATH = '/tmp/youtube_cookies.txt';

/** 딜레이 헬퍼 */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 429 에러 여부 확인 */
const isRateLimitError = (error: Error): boolean =>
  error.message.includes('429') || error.message.includes('Too Many Requests');

/** 쿠키 만료/봇 감지 에러 여부 확인 */
const isCookieError = (error: Error): boolean =>
  error.message.includes('Sign in to confirm') ||
  error.message.includes('not a bot') ||
  error.message.includes('cookies');

/** 회원전용 비디오 에러 여부 확인 */
const isMembersOnlyError = (error: Error): boolean =>
  error.message.includes('members') ||
  error.message.includes('Join this channel') ||
  error.message.includes('membership') ||
  error.message.includes('available to this channel');

interface YtDlpOutput {
  id: string;
  title: string;
  description: string;
  duration: number;
  upload_date: string;
  channel_id: string;
  channel: string;
  uploader: string;
  thumbnail: string;
  view_count?: number;
  like_count?: number;
  aspect_ratio?: number;
  webpage_url?: string;
}

/**
 * YouTube 추출기 어댑터
 * yt-dlp + youtubei.js를 사용한 YouTube 비디오 정보 추출
 */
@Injectable()
export class YouTubeExtractorAdapter implements IYouTubeExtractorPort, OnModuleInit {
  private readonly logger = new Logger(YouTubeExtractorAdapter.name);
  private youtube: Innertube | null = null;
  private maxTranscriptLength: number;
  private slackWebhookUrl: string | undefined;
  private cookieErrorNotified = false; // 쿠키 오류 알림 중복 방지

  // Circuit Breaker 상태
  private circuitState: 'closed' | 'open' = 'closed';
  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;
  private rateLimitNotified = false; // rate limit 알림 중복 방지

  constructor(private readonly configService: ConfigService) {
    this.maxTranscriptLength = this.configService.get<number>(
      'YOUTUBE_MAX_TRANSCRIPT_LENGTH',
      5000,
    );
    this.slackWebhookUrl = this.configService.get<string>('SLACK_WEBHOOK_URL');
  }

  onModuleInit() {
    this.initializeCookiesFile();
    this.logger.log('YouTubeExtractorAdapter initialized');
  }

  /**
   * Circuit Breaker 상태 조회 (모니터링/디버깅용)
   */
  getCircuitBreakerStatus(): {
    state: 'closed' | 'open';
    consecutiveFailures: number;
    isYtDlpAvailable: boolean;
    remainingCooldownMs: number | null;
  } {
    let remainingCooldownMs: number | null = null;
    if (this.circuitState === 'open' && this.circuitOpenedAt) {
      const elapsed = Date.now() - this.circuitOpenedAt;
      remainingCooldownMs = Math.max(0, CIRCUIT_BREAKER_CONFIG.cooldownMs - elapsed);
    }

    return {
      state: this.circuitState,
      consecutiveFailures: this.consecutiveFailures,
      isYtDlpAvailable: this.isYtDlpAvailable(),
      remainingCooldownMs,
    };
  }

  /**
   * 환경 변수에서 YouTube 쿠키 파일 생성
   * Railway에서 YOUTUBE_COOKIES_BASE64 환경변수로 쿠키 전달
   */
  private initializeCookiesFile(): void {
    const cookiesBase64 = this.configService.get<string>('YOUTUBE_COOKIES_BASE64');

    if (!cookiesBase64) {
      this.logger.log('YOUTUBE_COOKIES_BASE64 not set, skipping cookies setup');
      return;
    }

    try {
      const cookiesContent = Buffer.from(cookiesBase64, 'base64').toString('utf-8');
      fs.writeFileSync(COOKIES_FILE_PATH, cookiesContent, 'utf-8');
      this.logger.log(`YouTube cookies file created at ${COOKIES_FILE_PATH}`);
    } catch (error) {
      this.logger.error(`Failed to create cookies file: ${(error as Error).message}`);
    }
  }

  /**
   * 쿠키 파일이 존재하면 --cookies 플래그 반환
   */
  private getCookiesFlag(): string {
    if (fs.existsSync(COOKIES_FILE_PATH)) {
      return `--cookies "${COOKIES_FILE_PATH}"`;
    }
    return '';
  }

  /**
   * 쿠키 오류 발생 시 Slack 알림 전송 (1회만)
   */
  private async notifyCookieError(errorMessage: string): Promise<void> {
    if (this.cookieErrorNotified || !this.slackWebhookUrl) {
      return;
    }

    this.cookieErrorNotified = true;
    this.logger.warn('YouTube cookie error detected, sending Slack notification');

    const message = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 YouTube 쿠키 만료/인증 오류',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*yt-dlp에서 쿠키 인증 오류가 발생했습니다.*\n\n쿠키를 갱신해주세요:\n1. 브라우저에서 YouTube 로그인\n2. 쿠키 추출 후 Base64 인코딩\n3. Railway `YOUTUBE_COOKIES_BASE64` 환경변수 업데이트',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `\`\`\`${errorMessage.substring(0, 300)}\`\`\``,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🕐 발생 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
            },
          ],
        },
      ],
    };

    try {
      await fetch(this.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
    } catch (error) {
      this.logger.error(`Failed to send cookie error notification: ${(error as Error).message}`);
    }
  }

  /**
   * Circuit Breaker: yt-dlp 호출 가능 여부 확인
   * - 연속 실패 시 circuit이 열리고 yt-dlp 호출 차단
   * - 쿨다운 후 자동 복구
   */
  private isYtDlpAvailable(): boolean {
    if (this.circuitState === 'closed') {
      return true;
    }

    // 쿨다운 경과 확인
    if (this.circuitOpenedAt) {
      const elapsed = Date.now() - this.circuitOpenedAt;
      if (elapsed >= CIRCUIT_BREAKER_CONFIG.cooldownMs) {
        this.logger.log('Circuit breaker: cooldown expired, resetting to closed state');
        this.resetCircuit();
        return true;
      }
      const remainingMin = Math.ceil((CIRCUIT_BREAKER_CONFIG.cooldownMs - elapsed) / 60000);
      this.logger.debug(`Circuit breaker: open, ${remainingMin}min remaining`);
    }

    return false;
  }

  /**
   * Circuit Breaker: 성공 시 호출
   */
  private recordYtDlpSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.circuitState === 'open') {
      this.logger.log('Circuit breaker: success after cooldown, circuit closed');
      this.resetCircuit();
    }
  }

  /**
   * Circuit Breaker: Rate limit 실패 시 호출
   */
  private recordYtDlpRateLimitFailure(): void {
    this.consecutiveFailures++;
    this.logger.warn(`Circuit breaker: rate limit failure ${this.consecutiveFailures}/${CIRCUIT_BREAKER_CONFIG.failureThreshold}`);

    if (this.consecutiveFailures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
      this.openCircuit();
    }
  }

  /**
   * Circuit 열기 (yt-dlp 차단)
   */
  private openCircuit(): void {
    this.circuitState = 'open';
    this.circuitOpenedAt = Date.now();
    const cooldownMin = CIRCUIT_BREAKER_CONFIG.cooldownMs / 60000;
    this.logger.warn(`Circuit breaker: OPEN - yt-dlp disabled for ${cooldownMin} minutes`);

    // Rate limit 알림 (1회만)
    this.notifyRateLimitCircuitOpen();
  }

  /**
   * Circuit 리셋
   */
  private resetCircuit(): void {
    this.circuitState = 'closed';
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = null;
    this.rateLimitNotified = false;
  }

  /**
   * Rate Limit Circuit Open 시 Slack 알림
   */
  private async notifyRateLimitCircuitOpen(): Promise<void> {
    if (this.rateLimitNotified || !this.slackWebhookUrl) {
      return;
    }

    this.rateLimitNotified = true;
    const cooldownMin = CIRCUIT_BREAKER_CONFIG.cooldownMs / 60000;

    const message = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '⚡ YouTube Rate Limit - Circuit Breaker 활성화',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*YouTube API rate limit이 감지되어 yt-dlp 호출을 일시 중단합니다.*\n\n• 연속 실패: ${this.consecutiveFailures}회\n• 쿨다운: ${cooldownMin}분\n• YouTubei.js로 대체 처리 중`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🕐 발생 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
            },
          ],
        },
      ],
    };

    try {
      await fetch(this.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
    } catch (error) {
      this.logger.error(`Failed to send rate limit notification: ${(error as Error).message}`);
    }
  }

  private async getYouTubeInstance(): Promise<Innertube> {
    if (!this.youtube) {
      this.youtube = await Innertube.create();
    }
    return this.youtube;
  }

  async getVideoInfo(videoId: string): Promise<YouTubeVideoInfo> {
    const normalizedId = extractVideoId(videoId);
    if (!normalizedId) {
      throw new Error(`Invalid video ID: ${videoId}`);
    }

    // youtubei.js 17 단독 사용 — 쿠키 불필요, YouTube InnerTube API 호출.
    // 과거에는 필드 누락 시 yt-dlp로 보완했지만 yt-dlp는 Railway 공유 IP의 봇 감지와 쿠키 만료
    // 사이클에 계속 걸려 critical path에서 제거. 필수 필드 중 하나라도 빠지면 즉시 실패 처리해서
    // "duration=0 → rate limiting" 류의 잘못된 silent degradation을 막는다.
    const result = await this.extractWithYoutubeiJs(normalizedId);

    const missingRequired = this.getMissingRequiredFields(result);
    if (missingRequired.length > 0) {
      throw new Error(
        `youtubei.js returned incomplete data for ${normalizedId}, missing required fields: ${missingRequired.join(', ')}`,
      );
    }

    // 제목 보완: youtubei.js에서 비정상적으로 짧게 나오면 oEmbed로 회복
    if (!result.title || result.title.length < 3) {
      const oembedTitle = await this.fetchTitleFromOembed(normalizedId);
      if (oembedTitle) {
        this.logger.log(`[${normalizedId}] Title recovered from oEmbed: ${oembedTitle}`);
        result.title = oembedTitle;
      }
    }

    // publishedAt은 RSS 피드에서 이미 input으로 들어오므로 여기는 폴백 용도만
    if (!result.publishedAt) {
      result.publishedAt = new Date().toISOString();
    }

    return result;
  }

  async getTranscript(videoId: string): Promise<TranscriptResult | null> {
    // 1차: youtube-transcript 패키지로 자막 추출 시도 (쿠키 불필요)
    const youtubeiTranscript = await this.extractTranscriptWithYoutubeiJs(videoId);
    if (youtubeiTranscript) {
      this.logger.debug(`[${videoId}] Transcript extracted via youtube-transcript`);
      return { text: youtubeiTranscript };
    }

    // 2차: yt-dlp로 자막 추출 폴백 (Circuit Breaker 확인)
    if (this.isYtDlpAvailable()) {
      this.logger.debug(`[${videoId}] youtube-transcript failed, trying yt-dlp`);
      const transcript = await this.extractTranscriptWithYtDlp(videoId);
      if (transcript) {
        return { text: transcript };
      }
    } else {
      this.logger.debug(`[${videoId}] Circuit open, skipping yt-dlp transcript extraction`);
    }

    return null;
  }

  async getVideoInfoWithTranscript(videoId: string): Promise<YouTubeVideoInfo> {
    const info = await this.getVideoInfo(videoId);
    if (!info.transcript) {
      const transcriptResult = await this.getTranscript(videoId);
      if (transcriptResult) {
        info.transcript = transcriptResult.text;
      }
    }
    return info;
  }

  /** 쇼츠 판단 기준: 3분 (180초) 이하 */
  private readonly SHORTS_DURATION_THRESHOLD = 180;

  /**
   * 쇼츠 여부를 빠르게 확인 (youtubei.js 사용, rate limit 영향 적음)
   * yt-dlp 호출 전에 사용하여 불필요한 API 호출 방지
   *
   * 쇼츠 판단 기준:
   * - is_short 플래그가 true이면 쇼츠
   * - duration > 0 AND duration <= 180초이면 쇼츠 (3분 이하 영상은 콘텐츠 리뷰로 부적합)
   */
  async checkIfShorts(videoId: string): Promise<{ isShorts: boolean; duration: number }> {
    const normalizedId = extractVideoId(videoId);
    if (!normalizedId) {
      return { isShorts: false, duration: 0 };
    }

    try {
      const youtube = await this.getYouTubeInstance();
      const info = await youtube.getInfo(normalizedId);

      if (!info.basic_info) {
        return { isShorts: false, duration: 0 };
      }

      const basicInfo = info.basic_info as any;
      let duration = 0;

      if (basicInfo.duration) {
        if (typeof basicInfo.duration === 'number') {
          duration = basicInfo.duration;
        } else if (basicInfo.duration.seconds_total) {
          duration = basicInfo.duration.seconds_total;
        }
      }

      // 쇼츠 판단: is_short 플래그 OR duration <= 180초
      // 3분 이하 영상은 콘텐츠 리뷰 영상으로 부적합하므로 스킵
      const isShorts = basicInfo.is_short === true || (duration > 0 && duration <= this.SHORTS_DURATION_THRESHOLD);

      this.logger.debug(`Shorts check for ${videoId}: is_short=${basicInfo.is_short}, duration=${duration}s, result=${isShorts}`);
      return { isShorts, duration };
    } catch (error) {
      this.logger.debug(`Shorts check failed for ${videoId}: ${(error as Error).message}`);
      // 에러 시 쇼츠 아님으로 처리 (보수적 접근)
      return { isShorts: false, duration: 0 };
    }
  }

  /**
   * yt-dlp 명령어 실행 (429 에러 시 지수 백오프 재시도 + 선제적 딜레이)
   */
  private async execYtDlpWithRetry(
    command: string,
    options: { timeout: number; maxBuffer?: number },
  ): Promise<{ stdout: string; stderr: string }> {
    const { maxRetries, baseDelayMs, maxDelayMs } = RATE_LIMIT_RETRY_CONFIG;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await execAsync(command, options);
        // 성공: circuit breaker 리셋 및 선제적 딜레이
        this.recordYtDlpSuccess();
        await delay(PROACTIVE_DELAY_MS);
        return result;
      } catch (error) {
        const err = error as Error;

        // 429 에러가 아니면 즉시 throw (circuit breaker에 영향 없음)
        if (!isRateLimitError(err)) {
          throw error;
        }

        // 마지막 시도였으면 circuit breaker 기록 후 throw
        if (attempt === maxRetries) {
          this.logger.warn(`Rate limit exceeded after ${maxRetries + 1} attempts`);
          this.recordYtDlpRateLimitFailure();
          throw error;
        }

        // 지수 백오프 딜레이 계산 (jitter 추가로 요청 분산)
        const jitter = Math.random() * 2000; // 0-2초 랜덤
        const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs) + jitter;
        this.logger.warn(`Rate limited (429), retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries + 1})`);
        await delay(delayMs);
      }
    }

    throw new Error('Unexpected retry loop exit');
  }

  private async extractWithYtDlp(videoId: string): Promise<YouTubeVideoInfo | null> {
    const tmpDir = os.tmpdir();
    const outputPath = path.join(tmpDir, `yt-video-${videoId}`);

    try {
      const cookiesFlag = this.getCookiesFlag();
      const { stdout } = await this.execYtDlpWithRetry(
        `yt-dlp ${cookiesFlag} ${YT_DLP_RATE_LIMIT_OPTIONS} --print-json --write-auto-subs --sub-lang ko --sub-format vtt --skip-download -o "${outputPath}" "https://www.youtube.com/watch?v=${videoId}"`,
        { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
      );

      const ytdlpData: YtDlpOutput = JSON.parse(stdout);
      let transcript = '';
      const vttPath = `${outputPath}.ko.vtt`;

      if (fs.existsSync(vttPath)) {
        transcript = this.parseVttFile(vttPath);
      } else {
        const files = fs
          .readdirSync(tmpDir)
          .filter((f) => f.startsWith(`yt-video-${videoId}`) && f.endsWith('.vtt'));
        if (files.length > 0) {
          transcript = this.parseVttFile(path.join(tmpDir, files[0]));
        }
      }

      // upload_date가 없거나 유효하지 않으면 빈 문자열 반환 (youtubei.js 폴백 트리거)
      let publishedAt = '';
      if (ytdlpData.upload_date && ytdlpData.upload_date.length === 8) {
        const year = ytdlpData.upload_date.substring(0, 4);
        const month = ytdlpData.upload_date.substring(4, 6);
        const day = ytdlpData.upload_date.substring(6, 8);
        publishedAt = `${year}-${month}-${day}T00:00:00Z`;
      }

      this.cleanupTempFiles(tmpDir, videoId);

      // 쇼츠 감지: 세로 영상 (aspect_ratio < 1) OR 3분 이하
      // aspect_ratio가 9:16이면 0.5625, 16:9면 1.78
      // 3분 이하 영상은 콘텐츠 리뷰 영상으로 부적합하므로 스킵
      const aspectRatio = ytdlpData.aspect_ratio;
      const duration = ytdlpData.duration || 0;
      const isVertical = aspectRatio !== undefined && aspectRatio < 1;
      const isShortDuration = duration > 0 && duration <= this.SHORTS_DURATION_THRESHOLD;
      const isShorts = isVertical || isShortDuration;

      return {
        id: videoId,
        title: ytdlpData.title || '',
        description: ytdlpData.description || '',
        duration,
        publishedAt,
        channelId: ytdlpData.channel_id || '',
        channelTitle: ytdlpData.channel || ytdlpData.uploader || '',
        thumbnail: ytdlpData.thumbnail || '',
        transcript: transcript
          ? transcript.substring(0, this.maxTranscriptLength)
          : undefined,
        viewCount: ytdlpData.view_count,
        likeCount: ytdlpData.like_count,
        isShorts,
      };
    } catch (error) {
      this.cleanupTempFiles(tmpDir, videoId);
      const errorMessage = (error as Error).message;
      this.logger.warn(`yt-dlp extraction failed for ${videoId}: ${errorMessage}`);

      // 회원전용 비디오 감지 시 특별한 에러 throw (호출자에서 스킵 처리)
      if (isMembersOnlyError(error as Error)) {
        this.logger.warn(`[${videoId}] Members-only video detected, skipping`);
        throw new Error(`[MEMBERS_ONLY] ${errorMessage}`);
      }

      // 쿠키 오류 감지 시 Slack 알림
      if (isCookieError(error as Error)) {
        this.notifyCookieError(errorMessage);
      }

      return null;
    }
  }

  private parseVttFile(filePath: string): string {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const textLines: string[] = [];
      const seenTexts = new Set<string>();

      for (const line of lines) {
        if (
          line.startsWith('WEBVTT') ||
          line.startsWith('Kind:') ||
          line.startsWith('Language:') ||
          line.includes('-->') ||
          line.trim() === '' ||
          line.match(/^\d{2}:\d{2}/)
        ) {
          continue;
        }

        const cleanText = line
          .replace(/<[^>]+>/g, '')
          .replace(/align:start position:\d+%/g, '')
          .trim();

        if (cleanText && !seenTexts.has(cleanText)) {
          seenTexts.add(cleanText);
          textLines.push(cleanText);
        }
      }

      return textLines.join(' ').replace(/\s+/g, ' ').trim();
    } catch (error) {
      this.logger.debug(`VTT file parsing failed: ${(error as Error).message}`);
      return '';
    }
  }

  private cleanupTempFiles(tmpDir: string, videoId: string): void {
    try {
      const files = fs
        .readdirSync(tmpDir)
        .filter((f) => f.startsWith(`yt-video-${videoId}`));
      files.forEach((f) => fs.unlinkSync(path.join(tmpDir, f)));
    } catch (error) {
      this.logger.debug(`Temp file cleanup failed for ${videoId}: ${(error as Error).message}`);
    }
  }

  /**
   * 등록 파이프라인 진행에 반드시 필요한 필드만 체크.
   * description/publishedAt은 RSS 피드 입력으로 보완되거나 없어도 동작하므로 제외.
   */
  private getMissingRequiredFields(info: YouTubeVideoInfo): string[] {
    const missing: string[] = [];
    if (!info.title) missing.push('title');
    if (!info.duration || info.duration === 0) missing.push('duration');
    if (!info.channelId) missing.push('channelId');
    if (!info.channelTitle) missing.push('channelTitle');
    if (!info.thumbnail) missing.push('thumbnail');
    return missing;
  }

  private async extractWithYoutubeiJs(videoId: string): Promise<YouTubeVideoInfo> {
    const youtube = await this.getYouTubeInstance();
    const info = await youtube.getInfo(videoId);

    if (!info.basic_info) {
      throw new Error(`Video not found: ${videoId}`);
    }

    const basicInfo = info.basic_info as any;

    // 제목이 없거나 유효하지 않으면 oEmbed API로 폴백
    let title = basicInfo.title || '';
    if (!title || title.length < 3) {
      const oembedTitle = await this.fetchTitleFromOembed(videoId);
      if (oembedTitle) {
        title = oembedTitle;
        this.logger.log(`[${videoId}] Title fetched from oEmbed: ${title}`);
      }
    }

    let duration = 0;
    if (basicInfo.duration) {
      if (typeof basicInfo.duration === 'number') {
        duration = basicInfo.duration;
      } else if (basicInfo.duration.seconds_total) {
        duration = basicInfo.duration.seconds_total;
      }
    }

    // 쇼츠 감지: is_short 플래그 OR duration <= 180초
    // 3분 이하 영상은 콘텐츠 리뷰 영상으로 부적합하므로 스킵
    const isShorts = basicInfo.is_short === true || (duration > 0 && duration <= this.SHORTS_DURATION_THRESHOLD);

    // 자막 추출 시도 (youtube-transcript 패키지 사용)
    let transcript: string | undefined;
    try {
      transcript = await this.extractTranscriptWithYoutubeTranscript(videoId);
      if (transcript) {
        this.logger.log(`[${videoId}] Transcript in getInfo: ${transcript.length} chars`);
      }
    } catch (error) {
      this.logger.debug(`[${videoId}] Transcript extraction in extractWithYoutubeiJs failed: ${(error as Error).message}`);
    }

    return {
      id: videoId,
      title,
      description: basicInfo.description || basicInfo.short_description || '',
      duration,
      publishedAt:
        basicInfo.upload_date || basicInfo.publish_date || new Date().toISOString(),
      channelId: basicInfo.channel_id || '',
      channelTitle: basicInfo.channel?.name || basicInfo.author || '',
      thumbnail: basicInfo.thumbnail?.[0]?.url || basicInfo.thumbnail?.url || '',
      viewCount: basicInfo.view_count,
      likeCount: basicInfo.like_count,
      isShorts,
      transcript,
    };
  }

  /**
   * YouTube oEmbed API로 제목 가져오기 (인증 불필요)
   * youtubei.js/yt-dlp 제목 추출 실패 시 폴백
   */
  private async fetchTitleFromOembed(videoId: string): Promise<string | null> {
    try {
      const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as { title?: string };
      return data.title || null;
    } catch (error) {
      this.logger.debug(`[${videoId}] oEmbed title fetch failed: ${(error as Error).message}`);
      return null;
    }
  }

  private mergeVideoInfo(
    primary: YouTubeVideoInfo,
    fallback: YouTubeVideoInfo,
    missingFields: string[],
  ): YouTubeVideoInfo {
    const result = { ...primary };
    for (const field of missingFields) {
      if (field in fallback && (fallback as any)[field]) {
        (result as any)[field] = (fallback as any)[field];
      }
    }
    return result;
  }

  private async extractTranscriptWithYtDlp(videoId: string): Promise<string> {
    const tmpDir = os.tmpdir();
    const outputPath = path.join(tmpDir, `yt-transcript-${videoId}`);

    try {
      const cookiesFlag = this.getCookiesFlag();
      await this.execYtDlpWithRetry(
        `yt-dlp ${cookiesFlag} ${YT_DLP_RATE_LIMIT_OPTIONS} --write-auto-subs --sub-lang ko --sub-format vtt --skip-download -o "${outputPath}" "https://www.youtube.com/watch?v=${videoId}"`,
        { timeout: 60000 },
      );

      const vttPath = `${outputPath}.ko.vtt`;
      if (fs.existsSync(vttPath)) {
        const transcript = this.parseVttFile(vttPath);
        this.cleanupTranscriptFiles(tmpDir, videoId);
        return transcript;
      }

      const files = fs
        .readdirSync(tmpDir)
        .filter((f) => f.startsWith(`yt-transcript-${videoId}`) && f.endsWith('.vtt'));
      if (files.length > 0) {
        const transcript = this.parseVttFile(path.join(tmpDir, files[0]));
        files.forEach((f) => fs.unlinkSync(path.join(tmpDir, f)));
        return transcript;
      }

      return '';
    } catch (error) {
      this.logger.debug(`Transcript extraction failed for ${videoId}: ${(error as Error).message}`);
      this.cleanupTranscriptFiles(tmpDir, videoId);
      return '';
    }
  }

  private cleanupTranscriptFiles(tmpDir: string, videoId: string): void {
    try {
      const files = fs
        .readdirSync(tmpDir)
        .filter((f) => f.startsWith(`yt-transcript-${videoId}`));
      files.forEach((f) => fs.unlinkSync(path.join(tmpDir, f)));
    } catch (error) {
      this.logger.debug(`Transcript file cleanup failed for ${videoId}: ${(error as Error).message}`);
    }
  }

  /**
   * youtube-transcript 패키지를 사용한 자막 추출 (IP 차단에 강함)
   */
  private async extractTranscriptWithYoutubeTranscript(videoId: string): Promise<string> {
    // 1차: 한국어 자막 시도
    try {
      const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, {
        lang: 'ko',
      });

      if (transcriptItems && transcriptItems.length > 0) {
        const textLines: string[] = [];
        const seenTexts = new Set<string>();

        for (const item of transcriptItems) {
          const text = (item.text || '').replace(/<[^>]+>/g, '').trim();
          if (text && !seenTexts.has(text)) {
            seenTexts.add(text);
            textLines.push(text);
          }
        }

        const result = textLines.join(' ').replace(/\s+/g, ' ').trim();
        if (result) {
          this.logger.debug(`[${videoId}] youtube-transcript (ko) extracted: ${result.length} chars`);
          return result.substring(0, this.maxTranscriptLength);
        }
      }
    } catch (error) {
      this.logger.debug(`[${videoId}] youtube-transcript (ko) failed: ${(error as Error).message}`);
    }

    // 2차: 영어 자막 시도
    try {
      const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, {
        lang: 'en',
      });

      if (transcriptItems && transcriptItems.length > 0) {
        const textLines: string[] = [];
        const seenTexts = new Set<string>();

        for (const item of transcriptItems) {
          const text = (item.text || '').replace(/<[^>]+>/g, '').trim();
          if (text && !seenTexts.has(text)) {
            seenTexts.add(text);
            textLines.push(text);
          }
        }

        const result = textLines.join(' ').replace(/\s+/g, ' ').trim();
        if (result) {
          this.logger.debug(`[${videoId}] youtube-transcript (en) extracted: ${result.length} chars`);
          return result.substring(0, this.maxTranscriptLength);
        }
      }
    } catch (error) {
      this.logger.debug(`[${videoId}] youtube-transcript (en) failed: ${(error as Error).message}`);
    }

    // 3차: 언어 지정 없이 기본 자막 시도
    try {
      const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);

      if (transcriptItems && transcriptItems.length > 0) {
        const textLines: string[] = [];
        const seenTexts = new Set<string>();

        for (const item of transcriptItems) {
          const text = (item.text || '').replace(/<[^>]+>/g, '').trim();
          if (text && !seenTexts.has(text)) {
            seenTexts.add(text);
            textLines.push(text);
          }
        }

        const result = textLines.join(' ').replace(/\s+/g, ' ').trim();
        if (result) {
          this.logger.debug(`[${videoId}] youtube-transcript (default) extracted: ${result.length} chars`);
          return result.substring(0, this.maxTranscriptLength);
        }
      }
    } catch (error) {
      this.logger.debug(`[${videoId}] youtube-transcript (default) failed: ${(error as Error).message}`);
    }

    return '';
  }

  /**
   * yt-dlp 실패 시 폴백으로 사용하는 자막 추출
   */
  private async extractTranscriptWithYoutubeiJs(videoId: string): Promise<string> {
    const result = await this.extractTranscriptWithYoutubeTranscript(videoId);
    if (result) {
      this.logger.log(`[${videoId}] Transcript extracted via youtube-transcript: ${result.length} chars`);
      return result;
    }
    this.logger.debug(`[${videoId}] All transcript extraction methods failed`);
    return '';
  }

  async getChannelVideos(
    channelId: string,
    maxResults: number = 100,
  ): Promise<ChannelVideoItem[]> {
    const resolvedId = await this.resolveChannelId(channelId);
    this.logger.log(`Fetching videos for channel: ${resolvedId}`);

    try {
      const youtube = await this.getYouTubeInstance();
      const channel = await youtube.getChannel(resolvedId);

      if (!channel) {
        throw new Error(`Channel not found: ${resolvedId}`);
      }

      const videos: ChannelVideoItem[] = [];
      let videosTab: any = await channel.getVideos();

      while (videos.length < maxResults) {
        const items = videosTab.videos || [];

        for (const item of items) {
          if (videos.length >= maxResults) break;

          const video = item as any;
          if (!video.id) continue;

          videos.push({
            videoId: video.id,
            title: video.title?.text || video.title || '',
            publishedAt: video.published?.text || new Date().toISOString(),
            thumbnail: video.thumbnails?.[0]?.url || '',
            viewCount: this.parseViewCount(video.view_count?.text || video.short_view_count?.text),
          });
        }

        if (!videosTab.has_continuation || videos.length >= maxResults) {
          break;
        }

        videosTab = await videosTab.getContinuation();
      }

      this.logger.log(`Found ${videos.length} videos for channel: ${channelId}`);
      return videos;
    } catch (error) {
      this.logger.error(`Failed to fetch channel videos: ${(error as Error).message}`);
      throw error;
    }
  }

  async getChannelMetadata(channelId: string): Promise<ChannelMetadata> {
    const resolvedId = await this.resolveChannelId(channelId);
    this.logger.log(`Fetching metadata for channel: ${resolvedId}`);

    // yt-dlp: subscriber_count 가져오기
    const ytdlpResult = await this.extractChannelMetadataWithYtDlp(resolvedId);

    // youtubei.js: logo_url, banner_url 가져오기
    const youtubeiResult = await this.extractChannelMetadataWithYoutubeiJs(resolvedId).catch(() => null);

    // 두 결과 병합 (yt-dlp 우선, youtubei.js로 보완)
    return {
      id: resolvedId,
      name: ytdlpResult?.name || youtubeiResult?.name || '',
      handleId: ytdlpResult?.handleId || youtubeiResult?.handleId,
      logoUrl: youtubeiResult?.logoUrl, // youtubei.js에서만 가져올 수 있음
      bannerUrl: youtubeiResult?.bannerUrl, // youtubei.js에서만 가져올 수 있음
      subscriberCount: ytdlpResult?.subscriberCount || youtubeiResult?.subscriberCount,
    };
  }

  private async extractChannelMetadataWithYtDlp(channelId: string): Promise<ChannelMetadata | null> {
    try {
      const cookiesFlag = this.getCookiesFlag();
      const { stdout } = await execAsync(
        `yt-dlp ${cookiesFlag} ${YT_DLP_RATE_LIMIT_OPTIONS} --dump-json --playlist-items 1 "https://www.youtube.com/channel/${channelId}/videos"`,
        { timeout: 60000 }
      );

      const data = JSON.parse(stdout);

      return {
        id: channelId,
        name: data.channel || data.uploader || '',
        handleId: data.uploader_id?.replace('@', ''),
        logoUrl: data.channel_url ? undefined : undefined, // yt-dlp doesn't provide logo
        bannerUrl: undefined, // yt-dlp doesn't provide banner
        subscriberCount: data.channel_follower_count,
      };
    } catch (error) {
      this.logger.debug(`yt-dlp channel metadata failed for ${channelId}: ${(error as Error).message}`);
      return null;
    }
  }

  private async extractChannelMetadataWithYoutubeiJs(channelId: string): Promise<ChannelMetadata> {
    try {
      const youtube = await this.getYouTubeInstance();
      const channel = await youtube.getChannel(channelId);

      if (!channel) {
        throw new Error(`Channel not found: ${channelId}`);
      }

      const metadata = channel.metadata as any;
      const header = channel.header as any;

      return {
        id: channelId,
        name: metadata?.title || header?.author?.name || '',
        handleId: metadata?.vanity_channel_url?.split('@')[1] || metadata?.external_id,
        logoUrl: metadata?.avatar?.[0]?.url || header?.author?.thumbnails?.[0]?.url,
        bannerUrl: header?.banner?.[0]?.url || metadata?.banner?.[0]?.url,
        subscriberCount: this.parseSubscriberCount(
          metadata?.subscriber_count || header?.subscriber_count?.text
        ),
      };
    } catch (error) {
      this.logger.error(`Failed to fetch channel metadata: ${(error as Error).message}`);
      throw error;
    }
  }

  private parseSubscriberCount(text: string | undefined): number | undefined {
    if (!text) return undefined;

    const cleaned = text.replace(/[^0-9.만천억KMB]/gi, '');

    if (/[KkB]/i.test(cleaned)) {
      const num = parseFloat(cleaned.replace(/[KkB]/gi, ''));
      if (cleaned.toLowerCase().includes('b')) return Math.round(num * 1000000000);
      if (cleaned.toLowerCase().includes('m')) return Math.round(num * 1000000);
      if (cleaned.toLowerCase().includes('k')) return Math.round(num * 1000);
    }

    if (cleaned.includes('억')) {
      const num = parseFloat(cleaned.replace('억', ''));
      return Math.round(num * 100000000);
    }
    if (cleaned.includes('만')) {
      const num = parseFloat(cleaned.replace('만', ''));
      return Math.round(num * 10000);
    }
    if (cleaned.includes('천')) {
      const num = parseFloat(cleaned.replace('천', ''));
      return Math.round(num * 1000);
    }

    const num = parseInt(cleaned, 10);
    return isNaN(num) ? undefined : num;
  }

  private parseViewCount(viewCountText: string | undefined): number | undefined {
    if (!viewCountText) return undefined;

    const cleaned = viewCountText.replace(/[^0-9.만천억]/g, '');

    if (cleaned.includes('억')) {
      const num = parseFloat(cleaned.replace('억', ''));
      return Math.round(num * 100000000);
    }
    if (cleaned.includes('만')) {
      const num = parseFloat(cleaned.replace('만', ''));
      return Math.round(num * 10000);
    }
    if (cleaned.includes('천')) {
      const num = parseFloat(cleaned.replace('천', ''));
      return Math.round(num * 1000);
    }

    const num = parseInt(cleaned, 10);
    return isNaN(num) ? undefined : num;
  }

  /**
   * 채널 핸들(@username) 또는 URL을 실제 채널 ID로 변환
   * youtubei.js를 먼저 시도하고, 실패하면 yt-dlp로 폴백
   */
  private async resolveChannelId(input: string): Promise<string> {
    // 이미 채널 ID 형식이면 그대로 반환 (UC로 시작하는 24자)
    if (input.startsWith('UC') && input.length === 24) {
      return input;
    }

    // 핸들 형식 자동 감지: @ 없이 전달된 핸들에 @ 추가
    // 채널 ID가 아닌데 (UC로 시작 안함) URL도 아니면 핸들로 간주
    let normalizedInput = input;
    if (!input.startsWith('@') && !input.includes('youtube.com') && !input.startsWith('UC')) {
      normalizedInput = `@${input}`;
      this.logger.log(`Auto-prefixing handle: ${input} → ${normalizedInput}`);
    }

    // @핸들이나 URL이면 변환 필요
    const needsResolve = normalizedInput.startsWith('@') || normalizedInput.includes('youtube.com');

    if (!needsResolve) {
      return normalizedInput;
    }

    this.logger.log(`Resolving channel ID for: ${normalizedInput}`);

    // 1차: youtubei.js로 시도
    try {
      const channelId = await this.resolveWithYoutubeiJs(normalizedInput);
      if (channelId) {
        this.logger.log(`Resolved via youtubei.js: ${channelId}`);
        return channelId;
      }
    } catch (error) {
      this.logger.warn(`youtubei.js resolution failed: ${(error as Error).message}`);
    }

    // 2차: yt-dlp로 폴백
    try {
      const channelId = await this.resolveWithYtDlp(normalizedInput);
      if (channelId) {
        this.logger.log(`Resolved via yt-dlp: ${channelId}`);
        return channelId;
      }
    } catch (error) {
      this.logger.warn(`yt-dlp resolution failed: ${(error as Error).message}`);
    }

    throw new Error(`Failed to resolve channel ID for: ${normalizedInput}`);
  }

  private async resolveWithYoutubeiJs(input: string): Promise<string | null> {
    const youtube = await this.getYouTubeInstance();

    // URL 형식으로 변환
    let url = input;
    if (input.startsWith('@')) {
      url = `https://www.youtube.com/${input}`;
    }

    const resolved = await youtube.resolveURL(url);
    const payload = resolved?.payload as any;

    if (payload?.browseId) {
      return payload.browseId;
    }

    return null;
  }

  private async resolveWithYtDlp(input: string): Promise<string | null> {
    // URL 형식으로 변환
    let url = input;
    if (input.startsWith('@')) {
      url = `https://www.youtube.com/${input}`;
    }

    try {
      const cookiesFlag = this.getCookiesFlag();
      const { stdout } = await execAsync(
        `yt-dlp ${cookiesFlag} ${YT_DLP_RATE_LIMIT_OPTIONS} --print channel_id "${url}" 2>/dev/null | head -1`,
        { timeout: 30000 },
      );

      const channelId = stdout.trim();
      if (channelId && channelId.startsWith('UC')) {
        return channelId;
      }

      return null;
    } catch (error) {
      this.logger.debug(`yt-dlp channel resolution failed for ${input}: ${(error as Error).message}`);
      return null;
    }
  }
}
