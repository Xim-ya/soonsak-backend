import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { XMLParser } from 'fast-xml-parser';
import { Innertube } from 'youtubei.js';
import { IRSSFeedPort, NoVideosTabError, RSSFeedEntry } from '@/application/ports';
import { buildRSSUrl } from '@/shared/utils';

interface RSSFeedEntryXML {
  'yt:videoId': string;
  title: string;
  published: string;
  updated: string;
  author: {
    name: string;
    uri: string;
  };
  'media:group': {
    'media:title': string;
    'media:description': string;
    'media:thumbnail': {
      '@_url': string;
    };
    'media:community'?: {
      'media:statistics'?: {
        '@_views': string;
      };
    };
  };
}

interface RSSFeed {
  feed: {
    title: string;
    entry: RSSFeedEntryXML | RSSFeedEntryXML[];
  };
}

/** 브라우저처럼 보이기 위한 User-Agent */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * RSS 피드 어댑터
 * YouTube RSS 피드 파싱 처리 (Cloudflare 프록시 사용)
 * RSS 실패 시 youtubei.js로 폴백
 */
@Injectable()
export class RSSFeedAdapter implements IRSSFeedPort, OnModuleInit {
  private readonly logger = new Logger(RSSFeedAdapter.name);
  private readonly parser: XMLParser;
  private readonly proxyUrl: string | undefined;
  private readonly proxyApiKey: string | undefined;
  private youtube: Innertube | null = null;

  constructor(private readonly configService: ConfigService) {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
    this.proxyUrl = this.configService.get<string>('CLOUDFLARE_PROXY_URL');
    this.proxyApiKey = this.configService.get<string>('CLOUDFLARE_PROXY_API_KEY');

    if (this.proxyUrl) {
      this.logger.log(`RSS proxy enabled: ${this.proxyUrl}`);
    }
  }

  async onModuleInit() {
    // youtubei.js 인스턴스 미리 생성
    try {
      this.youtube = await Innertube.create();
      this.logger.log('youtubei.js initialized for RSS fallback');
    } catch (error) {
      this.logger.warn(`youtubei.js initialization failed: ${(error as Error).message}`);
    }
  }

  private async getYouTubeInstance(): Promise<Innertube> {
    if (!this.youtube) {
      this.youtube = await Innertube.create();
    }
    return this.youtube;
  }

  async parseChannelFeed(channelId: string): Promise<RSSFeedEntry[]> {
    if (!channelId || channelId.trim() === '') {
      throw new Error('Channel ID is empty');
    }

    // channelId 추출 (URL인 경우)
    let extractedChannelId = channelId;
    if (channelId.startsWith('http')) {
      const match = channelId.match(/channel_id=([^&]+)/);
      extractedChannelId = match ? match[1] : channelId;
    }

    // 1차: RSS 피드 시도
    try {
      const entries = await this.fetchRSSFeed(extractedChannelId);
      if (entries.length > 0) {
        return entries;
      }
    } catch (error) {
      this.logger.warn(`RSS fetch failed for ${extractedChannelId}, trying youtubei.js fallback: ${(error as Error).message}`);
    }

    // 2차: youtubei.js 폴백
    try {
      const entries = await this.fetchWithYoutubeiJs(extractedChannelId);
      this.logger.log(`youtubei.js fallback successful for ${extractedChannelId}: ${entries.length} videos`);
      return entries;
    } catch (error) {
      this.logger.error(`Both RSS and youtubei.js failed for ${extractedChannelId}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * RSS 피드로 채널 비디오 가져오기
   */
  private async fetchRSSFeed(channelId: string): Promise<RSSFeedEntry[]> {
    let xmlText: string;

    // Cloudflare 프록시 사용 (설정된 경우)
    if (this.proxyUrl && this.proxyApiKey) {
      const proxyRssUrl = `${this.proxyUrl}/rss/${channelId}`;
      const response = await fetch(proxyRssUrl, {
        headers: {
          'X-API-Key': this.proxyApiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`RSS fetch failed with status ${response.status}`);
      }

      xmlText = await response.text();
    } else {
      // 직접 요청
      const rssUrl = buildRSSUrl(channelId);
      const response = await fetch(rssUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });

      if (!response.ok) {
        throw new Error(`RSS fetch failed with status ${response.status}`);
      }

      xmlText = await response.text();
    }

    const feed: RSSFeed = this.parser.parse(xmlText);

    if (!feed.feed?.entry) {
      return [];
    }

    const entries = Array.isArray(feed.feed.entry)
      ? feed.feed.entry
      : [feed.feed.entry];

    return entries.map((entry) => this.mapRSSEntry(entry, channelId));
  }

  /**
   * youtubei.js로 채널 비디오 가져오기 (RSS 실패 시 폴백)
   */
  private async fetchWithYoutubeiJs(channelId: string): Promise<RSSFeedEntry[]> {
    if (!channelId || channelId.trim() === '') {
      throw new Error('Channel ID is empty');
    }

    const youtube = await this.getYouTubeInstance();
    const channel = await youtube.getChannel(channelId);

    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    // 채널명 추출
    const channelMetadata = channel.metadata as any;
    const channelHeader = channel.header as any;
    const channelName = channelMetadata?.title || channelHeader?.author?.name || '';

    // 채널에 정규 Videos 탭이 없으면 더 이상 시도할 의미 없음
    // (Shorts 전용/빈 채널 — 후속 파이프라인이 쇼츠를 필터링하므로 쓸모없는 호출 반복 방지)
    if (!(channel as any).has_videos) {
      throw new NoVideosTabError(channelId);
    }

    const videos: RSSFeedEntry[] = [];
    let videosTab: any = await channel.getVideos();

    // 최대 15개 (RSS와 동일)
    const maxResults = 15;

    while (videos.length < maxResults) {
      const items = videosTab.videos || [];

      for (const item of items) {
        if (videos.length >= maxResults) break;

        const video = item as any;
        if (!video.id) continue;

        // 날짜 파싱 (youtubei.js는 상대 시간으로 반환할 수 있음)
        const publishedAt = this.parseYoutubeiDate(video.published?.text);

        videos.push({
          videoId: video.id,
          title: video.title?.text || video.title || '',
          description: '', // youtubei.js에서는 description 미제공
          publishedAt,
          updatedAt: publishedAt,
          channelId,
          channelName,
          thumbnail: video.thumbnails?.[0]?.url || '',
          viewCount: this.parseViewCount(video.view_count?.text || video.short_view_count?.text),
        });
      }

      if (!videosTab.has_continuation || videos.length >= maxResults) {
        break;
      }

      videosTab = await videosTab.getContinuation();
    }

    return videos;
  }

  /**
   * youtubei.js 날짜 문자열 파싱
   * "3 hours ago", "1 day ago" 등의 상대 시간을 ISO 문자열로 변환
   */
  private parseYoutubeiDate(dateText: string | undefined): string {
    if (!dateText) {
      return new Date().toISOString();
    }

    // 이미 ISO 형식이면 그대로 반환
    if (dateText.includes('-') && dateText.includes('T')) {
      return dateText;
    }

    const now = new Date();

    // 상대 시간 파싱
    const match = dateText.match(/(\d+)\s*(hour|day|week|month|year)s?\s*ago/i);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();

      switch (unit) {
        case 'hour':
          now.setHours(now.getHours() - value);
          break;
        case 'day':
          now.setDate(now.getDate() - value);
          break;
        case 'week':
          now.setDate(now.getDate() - value * 7);
          break;
        case 'month':
          now.setMonth(now.getMonth() - value);
          break;
        case 'year':
          now.setFullYear(now.getFullYear() - value);
          break;
      }

      return now.toISOString();
    }

    // "Streamed X ago" 패턴
    const streamedMatch = dateText.match(/Streamed\s+(\d+)\s*(hour|day|week|month|year)s?\s*ago/i);
    if (streamedMatch) {
      const value = parseInt(streamedMatch[1], 10);
      const unit = streamedMatch[2].toLowerCase();

      switch (unit) {
        case 'hour':
          now.setHours(now.getHours() - value);
          break;
        case 'day':
          now.setDate(now.getDate() - value);
          break;
        case 'week':
          now.setDate(now.getDate() - value * 7);
          break;
        case 'month':
          now.setMonth(now.getMonth() - value);
          break;
        case 'year':
          now.setFullYear(now.getFullYear() - value);
          break;
      }

      return now.toISOString();
    }

    return new Date().toISOString();
  }

  /**
   * 조회수 텍스트 파싱
   */
  private parseViewCount(viewCountText: string | undefined): number | undefined {
    if (!viewCountText) return undefined;

    const cleaned = viewCountText.replace(/[^0-9.만천억KMB]/gi, '');

    // 영어 단위 (K, M, B)
    if (/[KkMmBb]/i.test(cleaned)) {
      const num = parseFloat(cleaned.replace(/[KkMmBb]/gi, ''));
      if (cleaned.toLowerCase().includes('b')) return Math.round(num * 1000000000);
      if (cleaned.toLowerCase().includes('m')) return Math.round(num * 1000000);
      if (cleaned.toLowerCase().includes('k')) return Math.round(num * 1000);
    }

    // 한국어 단위
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

  async getRecentVideos(channelId: string, maxResults = 15): Promise<RSSFeedEntry[]> {
    const entries = await this.parseChannelFeed(channelId);
    return entries.slice(0, maxResults);
  }

  private extractChannelIdFromRSS(rssUrl: string): string {
    const match = rssUrl.match(/channel_id=([^&]+)/);
    return match ? match[1] : '';
  }

  private mapRSSEntry(entry: RSSFeedEntryXML, channelId: string): RSSFeedEntry {
    const mediaGroup = entry['media:group'];

    return {
      videoId: entry['yt:videoId'],
      title: mediaGroup?.['media:title'] || entry.title,
      description: mediaGroup?.['media:description'] || '',
      publishedAt: entry.published,
      updatedAt: entry.updated,
      channelId,
      channelName: entry.author?.name || '',
      thumbnail: mediaGroup?.['media:thumbnail']?.['@_url'] || '',
      viewCount: mediaGroup?.['media:community']?.['media:statistics']
        ? parseInt(
            mediaGroup['media:community']['media:statistics']['@_views'] || '0',
          )
        : undefined,
    };
  }
}
