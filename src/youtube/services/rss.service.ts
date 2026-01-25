import { Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { YouTubeRSSEntry } from '@/common/types';
import { YouTubeException } from '@/common/exceptions';
import { buildRSSUrl } from '@/common/utils';

interface RSSFeedEntry {
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
    entry: RSSFeedEntry | RSSFeedEntry[];
  };
}

/**
 * YouTube RSS 서비스
 * RSS 피드 파싱 처리
 */
@Injectable()
export class YouTubeRSSService {
  private readonly logger = new Logger(YouTubeRSSService.name);
  private readonly parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
  }

  /**
   * RSS 피드 파싱 후 비디오 엔트리 반환
   */
  async parseChannelFeed(channelIdOrRssUrl: string): Promise<YouTubeRSSEntry[]> {
    const rssUrl = channelIdOrRssUrl.startsWith('http') ? channelIdOrRssUrl : buildRSSUrl(channelIdOrRssUrl);

    try {
      const response = await fetch(rssUrl);
      if (!response.ok) {
        throw YouTubeException.rssFetchFailed(response.status);
      }

      const xmlText = await response.text();
      const feed: RSSFeed = this.parser.parse(xmlText);

      if (!feed.feed?.entry) {
        return [];
      }

      const entries = Array.isArray(feed.feed.entry) ? feed.feed.entry : [feed.feed.entry];
      const channelId = this.extractChannelIdFromRSS(rssUrl);

      return entries.map((entry) => this.mapRSSEntry(entry, channelId));
    } catch (error) {
      if (error instanceof YouTubeException) throw error;
      throw YouTubeException.rssParseFailed(error as Error);
    }
  }

  /**
   * RSS URL에서 채널 ID 추출
   */
  private extractChannelIdFromRSS(rssUrl: string): string {
    const match = rssUrl.match(/channel_id=([^&]+)/);
    return match ? match[1] : '';
  }

  /**
   * RSS 엔트리를 YouTubeRSSEntry로 매핑
   */
  private mapRSSEntry(entry: RSSFeedEntry, channelId: string): YouTubeRSSEntry {
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
        ? parseInt(mediaGroup['media:community']['media:statistics']['@_views'] || '0')
        : undefined,
    };
  }

  /**
   * 채널의 최근 비디오 조회
   */
  async getRecentVideos(channelId: string, maxResults = 15): Promise<YouTubeRSSEntry[]> {
    const entries = await this.parseChannelFeed(channelId);
    return entries.slice(0, maxResults);
  }
}
