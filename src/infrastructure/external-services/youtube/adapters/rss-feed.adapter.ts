import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { XMLParser } from 'fast-xml-parser';
import { IRSSFeedPort, RSSFeedEntry } from '@/application/ports';
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
 */
@Injectable()
export class RSSFeedAdapter implements IRSSFeedPort {
  private readonly logger = new Logger(RSSFeedAdapter.name);
  private readonly parser: XMLParser;
  private readonly proxyUrl: string | undefined;
  private readonly proxyApiKey: string | undefined;

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

  async parseChannelFeed(channelId: string): Promise<RSSFeedEntry[]> {
    // channelId 추출 (URL인 경우)
    let extractedChannelId = channelId;
    if (channelId.startsWith('http')) {
      const match = channelId.match(/channel_id=([^&]+)/);
      extractedChannelId = match ? match[1] : channelId;
    }

    try {
      let xmlText: string;

      // Cloudflare 프록시 사용 (설정된 경우)
      if (this.proxyUrl && this.proxyApiKey) {
        const proxyRssUrl = `${this.proxyUrl}/rss/${extractedChannelId}`;
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
        // 직접 요청 (폴백)
        const rssUrl = buildRSSUrl(extractedChannelId);
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

      return entries.map((entry) => this.mapRSSEntry(entry, extractedChannelId));
    } catch (error) {
      this.logger.error(`RSS parsing failed for ${extractedChannelId}: ${(error as Error).message}`);
      throw error;
    }
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
