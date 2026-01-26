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
} from '@/application/ports';
import { extractVideoId } from '@/shared/utils';

const execAsync = promisify(exec);

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
    this.logger.log('YouTubeExtractorAdapter initialized');
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
      } catch {
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

  private async extractWithYtDlp(videoId: string): Promise<YouTubeVideoInfo | null> {
    const tmpDir = os.tmpdir();
    const outputPath = path.join(tmpDir, `yt-video-${videoId}`);

    try {
      const { stdout } = await execAsync(
        `yt-dlp --print-json --write-auto-subs --sub-lang ko --sub-format vtt --skip-download -o "${outputPath}" "https://www.youtube.com/watch?v=${videoId}"`,
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
    } catch {
      return '';
    }
  }

  private cleanupTempFiles(tmpDir: string, videoId: string): void {
    try {
      const files = fs
        .readdirSync(tmpDir)
        .filter((f) => f.startsWith(`yt-video-${videoId}`));
      files.forEach((f) => fs.unlinkSync(path.join(tmpDir, f)));
    } catch {
      // 정리 오류 무시
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
      await execAsync(
        `yt-dlp --write-auto-subs --sub-lang ko --sub-format vtt --skip-download -o "${outputPath}" "https://www.youtube.com/watch?v=${videoId}"`,
        { timeout: 30000 },
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
    } catch {
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
    } catch {
      // 정리 오류 무시
    }
  }
}
