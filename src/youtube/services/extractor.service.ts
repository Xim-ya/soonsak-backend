import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Innertube } from 'youtubei.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { YouTubeVideoInfo } from '@/common/types';
import { YouTubeException } from '@/common/exceptions';
import { extractVideoId } from '@/common/utils';

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
 * YouTube 비디오 추출 서비스
 * yt-dlp를 기본으로 사용하고 youtubei.js를 폴백으로 사용하여 비디오 정보 추출
 */
@Injectable()
export class YouTubeExtractorService implements OnModuleInit {
  private readonly logger = new Logger(YouTubeExtractorService.name);
  private youtube: Innertube | null = null;
  private maxTranscriptLength: number;

  constructor(private readonly configService: ConfigService) {
    this.maxTranscriptLength = this.configService.get<number>('YOUTUBE_MAX_TRANSCRIPT_LENGTH', 5000);
  }

  async onModuleInit() {
    this.logger.log('YouTube Extractor Service initialized');
  }

  /**
   * YouTube 클라이언트 초기화 (폴백용)
   */
  private async getYouTubeInstance(): Promise<Innertube> {
    if (!this.youtube) {
      try {
        this.youtube = await Innertube.create();
      } catch (error) {
        throw YouTubeException.initFailed(error as Error);
      }
    }
    return this.youtube;
  }

  /**
   * yt-dlp를 기본으로 사용하여 YouTube 비디오 정보 조회
   */
  async getVideoInfo(urlOrId: string): Promise<YouTubeVideoInfo> {
    const videoId = extractVideoId(urlOrId);
    if (!videoId) {
      throw YouTubeException.invalidVideoId(urlOrId);
    }

    const ytdlpResult = await this.extractWithYtDlp(videoId);

    if (ytdlpResult) {
      const missingFields = this.getMissingFields(ytdlpResult);

      if (missingFields.length === 0) {
        return ytdlpResult;
      }

      try {
        const fallbackData = await this.extractWithYoutubeiJs(videoId);
        return this.mergeVideoInfo(ytdlpResult, fallbackData, missingFields);
      } catch {
        return ytdlpResult;
      }
    }

    return this.extractWithYoutubeiJs(videoId);
  }

  /**
   * yt-dlp를 사용하여 비디오 정보 추출
   */
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
        const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith(`yt-video-${videoId}`) && f.endsWith('.vtt'));
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
        transcript: transcript ? transcript.substring(0, this.maxTranscriptLength) : undefined,
        viewCount: ytdlpData.view_count,
      };
    } catch (error) {
      this.cleanupTempFiles(tmpDir, videoId);
      this.logger.warn(`yt-dlp extraction failed for ${videoId}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * VTT 파일을 파싱하여 깨끗한 텍스트 추출
   */
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

  /**
   * 임시 파일 정리
   */
  private cleanupTempFiles(tmpDir: string, videoId: string): void {
    try {
      const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith(`yt-video-${videoId}`));
      files.forEach((f) => fs.unlinkSync(path.join(tmpDir, f)));
    } catch {
      // 정리 오류 무시
    }
  }

  /**
   * 필수 필드 중 누락되거나 비어있는 항목 확인
   */
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

  /**
   * youtubei.js를 사용하여 비디오 정보 추출 (폴백)
   */
  private async extractWithYoutubeiJs(videoId: string): Promise<YouTubeVideoInfo> {
    try {
      const youtube = await this.getYouTubeInstance();
      const info = await youtube.getInfo(videoId);

      if (!info.basic_info) {
        throw YouTubeException.videoNotFound(videoId);
      }

      const basicInfo = info.basic_info as any;

      let duration = 0;
      if (basicInfo.duration) {
        if (typeof basicInfo.duration === 'number') {
          duration = basicInfo.duration;
        } else if (basicInfo.duration.seconds_total) {
          duration = basicInfo.duration.seconds_total;
        } else if (basicInfo.duration.text) {
          const timeMatch = basicInfo.duration.text.match(/(\d+):(\d+)/);
          if (timeMatch) {
            duration = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
          }
        }
      }

      let description = basicInfo.description || basicInfo.short_description || '';
      if (description.length < 100) {
        try {
          const fullDescription = await this.fetchFullDescription(videoId);
          if (fullDescription && fullDescription.length > description.length) {
            description = fullDescription;
          }
        } catch {
          // 기존 설명 사용
        }
      }

      return {
        id: videoId,
        title: basicInfo.title || '',
        description,
        duration,
        publishedAt: basicInfo.upload_date || basicInfo.publish_date || new Date().toISOString(),
        channelId: basicInfo.channel_id || '',
        channelTitle: basicInfo.channel?.name || basicInfo.author || '',
        thumbnail: basicInfo.thumbnail?.[0]?.url || basicInfo.thumbnail?.url || '',
        viewCount: basicInfo.view_count,
      };
    } catch (error) {
      if (error instanceof YouTubeException) throw error;
      throw YouTubeException.fetchFailed('video info', error as Error);
    }
  }

  /**
   * yt-dlp 결과와 youtubei.js 폴백 데이터 병합
   */
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

  /**
   * 비디오 재생 시간 조회 (초 단위)
   */
  async getVideoRuntime(urlOrId: string): Promise<number | null> {
    try {
      const info = await this.getVideoInfo(urlOrId);
      return info.duration || null;
    } catch {
      return null;
    }
  }

  /**
   * 웹 스크래핑을 통한 전체 설명 조회 (폴백)
   */
  private async fetchFullDescription(videoId: string): Promise<string | null> {
    try {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!res.ok) return null;

      const html = await res.text();
      const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      if (descMatch) {
        return descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 분석용 자막 세그먼트 추출
   */
  async extractTranscriptWithSegments(
    videoId: string,
  ): Promise<{ full: string; start: string; end: string } | null> {
    const fullText = await this.extractTranscriptWithYtDlp(videoId);

    if (fullText) {
      if (fullText.length < 300) {
        return { full: fullText, start: fullText, end: '' };
      }
      return {
        full: fullText,
        start: fullText.substring(0, 300),
        end: fullText.substring(fullText.length - 300),
      };
    }

    try {
      const youtube = await this.getYouTubeInstance();
      const info = await youtube.getInfo(videoId);
      const transcriptData = await info.getTranscript();

      if (!transcriptData?.transcript?.content) {
        return null;
      }

      const content = transcriptData.transcript.content as any;
      let text = '';

      if (content.runs && Array.isArray(content.runs)) {
        text = content.runs.map((run: any) => run.text || '').join(' ');
      } else if (typeof content === 'string') {
        text = content;
      }

      if (!text || text.length < 300) {
        return { full: text, start: text, end: '' };
      }

      return {
        full: text,
        start: text.substring(0, 300),
        end: text.substring(text.length - 300),
      };
    } catch {
      return null;
    }
  }

  /**
   * yt-dlp만 사용하여 자막 추출
   */
  async extractTranscriptWithYtDlp(videoId: string): Promise<string> {
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

      const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith(`yt-transcript-${videoId}`) && f.endsWith('.vtt'));
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

  /**
   * 자막 임시 파일 정리
   */
  private cleanupTranscriptFiles(tmpDir: string, videoId: string): void {
    try {
      const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith(`yt-transcript-${videoId}`));
      files.forEach((f) => fs.unlinkSync(path.join(tmpDir, f)));
    } catch {
      // 정리 오류 무시
    }
  }

  /**
   * 전체 자막 조회 (외부 사용용)
   */
  async getTranscript(videoId: string): Promise<string> {
    const info = await this.getVideoInfo(videoId);
    return info.transcript || '';
  }
}
