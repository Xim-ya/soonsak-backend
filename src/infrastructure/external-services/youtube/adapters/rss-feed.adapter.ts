import { Injectable, Logger } from '@nestjs/common';
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
 * YouTube RSS 피드 파싱 처리
 */
@Injectable()
export class RSSFeedAdapter implements IRSSFeedPort {
  private readonly logger = new Logger(RSSFeedAdapter.name);
  private readonly parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
  }

  async parseChannelFeed(channelId: string): Promise<RSSFeedEntry[]> {
    const rssUrl = channelId.startsWith('http') ? channelId : buildRSSUrl(channelId);

    try {
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

      const xmlText = await response.text();
      const feed: RSSFeed = this.parser.parse(xmlText);

      if (!feed.feed?.entry) {
        return [];
      }

      const entries = Array.isArray(feed.feed.entry)
        ? feed.feed.entry
        : [feed.feed.entry];
      const extractedChannelId = this.extractChannelIdFromRSS(rssUrl);

      return entries.map((entry) => this.mapRSSEntry(entry, extractedChannelId));
    } catch (error) {
      this.logger.error(`RSS parsing failed: ${(error as Error).message}`);
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
