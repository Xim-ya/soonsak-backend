import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Innertube } from 'youtubei.js';
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
  maxRetries: 5,        // 3 → 5 (총 6회 시도)
  baseDelayMs: 8000,    // 5초 → 8초
  maxDelayMs: 60000,    // 30초 → 60초
};

/** 선제적 요청 간 딜레이 (rate limit 방지) */
const PROACTIVE_DELAY_MS = 2000; // 2초

/** 쿠키 파일 경로 */
const COOKIES_FILE_PATH = '/tmp/youtube_cookies.txt';

/** 딜레이 헬퍼 */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 429 에러 여부 확인 */
const isRateLimitError = (error: Error): boolean =>
  error.message.includes('429') || error.message.includes('Too Many Requests');

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

  constructor(private readonly configService: ConfigService) {
    this.maxTranscriptLength = this.configService.get<number>(
      'YOUTUBE_MAX_TRANSCRIPT_LENGTH',
      5000,
    );
  }

  onModuleInit() {
    this.initializeCookiesFile();
    this.logger.log('YouTubeExtractorAdapter initialized');
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

    const ytdlpResult = await this.extractWithYtDlp(normalizedId);
    if (ytdlpResult) {
      const missingFields = this.getMissingFields(ytdlpResult);
      if (missingFields.length === 0) {
        return ytdlpResult;
      }

      try {
        const fallbackData = await this.extractWithYoutubeiJs(normalizedId);
        return this.mergeVideoInfo(ytdlpResult, fallbackData, missingFields);
      } catch (error) {
        this.logger.debug(`youtubei.js fallback failed for ${normalizedId}: ${(error as Error).message}`);
        return ytdlpResult;
      }
    }

    return this.extractWithYoutubeiJs(normalizedId);
  }

  async getTranscript(videoId: string): Promise<TranscriptResult | null> {
    const transcript = await this.extractTranscriptWithYtDlp(videoId);
    if (!transcript) {
      return null;
    }

    return { text: transcript };
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

  /**
   * 쇼츠 여부를 빠르게 확인 (youtubei.js 사용, rate limit 영향 적음)
   * yt-dlp 호출 전에 사용하여 불필요한 API 호출 방지
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

      const isShorts = duration > 0 && duration <= 180;
      return { isShorts, duration };
    } catch (error) {
      this.logger.debug(`Shorts check failed for ${videoId}: ${(error as Error).message}`);
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
        // 성공 후 선제적 딜레이 (다음 요청 전 rate limit 방지)
        await delay(PROACTIVE_DELAY_MS);
        return result;
      } catch (error) {
        const err = error as Error;

        // 429 에러가 아니면 즉시 throw
        if (!isRateLimitError(err)) {
          throw error;
        }

        // 마지막 시도였으면 throw
        if (attempt === maxRetries) {
          this.logger.warn(`Rate limit exceeded after ${maxRetries + 1} attempts`);
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
        `yt-dlp ${cookiesFlag} --print-json --write-auto-subs --sub-lang ko --sub-format vtt --skip-download -o "${outputPath}" "https://www.youtube.com/watch?v=${videoId}"`,
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

      let publishedAt = new Date().toISOString();
      if (ytdlpData.upload_date && ytdlpData.upload_date.length === 8) {
        const year = ytdlpData.upload_date.substring(0, 4);
        const month = ytdlpData.upload_date.substring(4, 6);
        const day = ytdlpData.upload_date.substring(6, 8);
        publishedAt = `${year}-${month}-${day}T00:00:00Z`;
      }

      this.cleanupTempFiles(tmpDir, videoId);

      // 쇼츠 감지: 3분 이하 영상
      const isShorts = (ytdlpData.duration || 0) <= 180;

      return {
        id: videoId,
        title: ytdlpData.title || '',
        description: ytdlpData.description || '',
        duration: ytdlpData.duration || 0,
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
      this.logger.warn(
        `yt-dlp extraction failed for ${videoId}: ${(error as Error).message}`,
      );
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

  private getMissingFields(info: YouTubeVideoInfo): string[] {
    const missing: string[] = [];
    if (!info.title) missing.push('title');
    if (!info.description) missing.push('description');
    if (!info.duration) missing.push('duration');
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

    let duration = 0;
    if (basicInfo.duration) {
      if (typeof basicInfo.duration === 'number') {
        duration = basicInfo.duration;
      } else if (basicInfo.duration.seconds_total) {
        duration = basicInfo.duration.seconds_total;
      }
    }

    // 쇼츠 감지: 3분 이하 영상
    const isShorts = duration <= 180;

    return {
      id: videoId,
      title: basicInfo.title || '',
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
    };
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
        `yt-dlp ${cookiesFlag} --write-auto-subs --sub-lang ko --sub-format vtt --skip-download -o "${outputPath}" "https://www.youtube.com/watch?v=${videoId}"`,
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
        `yt-dlp ${cookiesFlag} --dump-json --playlist-items 1 "https://www.youtube.com/channel/${channelId}/videos"`,
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

    // @핸들이나 URL이면 변환 필요
    const needsResolve = input.startsWith('@') || input.includes('youtube.com');

    if (!needsResolve) {
      return input;
    }

    this.logger.log(`Resolving channel ID for: ${input}`);

    // 1차: youtubei.js로 시도
    try {
      const channelId = await this.resolveWithYoutubeiJs(input);
      if (channelId) {
        this.logger.log(`Resolved via youtubei.js: ${channelId}`);
        return channelId;
      }
    } catch (error) {
      this.logger.warn(`youtubei.js resolution failed: ${(error as Error).message}`);
    }

    // 2차: yt-dlp로 폴백
    try {
      const channelId = await this.resolveWithYtDlp(input);
      if (channelId) {
        this.logger.log(`Resolved via yt-dlp: ${channelId}`);
        return channelId;
      }
    } catch (error) {
      this.logger.warn(`yt-dlp resolution failed: ${(error as Error).message}`);
    }

    throw new Error(`Failed to resolve channel ID for: ${input}`);
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
        `yt-dlp ${cookiesFlag} --print channel_id "${url}" 2>/dev/null | head -1`,
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
