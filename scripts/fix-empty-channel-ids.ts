/**
 * Fix videos with empty channel_id by fetching from YouTube oEmbed API
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'set' : 'missing');
  console.log('SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? 'set' : 'missing');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

interface VideoToFix {
  id: string;
  title: string;
}

interface OEmbedResponse {
  author_name: string;
  author_url: string;
}

async function getChannelInfoFromOEmbed(videoId: string): Promise<{ channelId: string; channelName: string } | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(url);

    if (!response.ok) {
      console.log(`  [SKIP] oEmbed failed for ${videoId}: ${response.status}`);
      return null;
    }

    const data: OEmbedResponse = await response.json();

    // Extract channel ID from author_url (e.g., https://www.youtube.com/@channelHandle or /channel/UCxxxx)
    const authorUrl = data.author_url;
    let channelId: string | null = null;

    // Try to extract channel ID from URL
    const channelMatch = authorUrl.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/);
    if (channelMatch) {
      channelId = channelMatch[1];
    } else {
      // If it's a handle URL, we need to resolve it
      // For now, we'll use the handle as a fallback identifier
      const handleMatch = authorUrl.match(/\/@([a-zA-Z0-9_-]+)/);
      if (handleMatch) {
        // Try to get channel ID from the channel page
        channelId = await resolveChannelIdFromHandle(handleMatch[1]);
      }
    }

    if (!channelId) {
      console.log(`  [SKIP] Could not extract channel ID for ${videoId}`);
      return null;
    }

    return {
      channelId,
      channelName: data.author_name,
    };
  } catch (error) {
    console.log(`  [ERROR] oEmbed error for ${videoId}:`, error);
    return null;
  }
}

async function resolveChannelIdFromHandle(handle: string): Promise<string | null> {
  try {
    // First, check if we already have this channel in our database by handle
    const { data: existingChannel } = await supabase
      .from('channels')
      .select('id')
      .eq('handle_id', `@${handle}`)
      .single();

    if (existingChannel) {
      return existingChannel.id;
    }

    // Try alternative: check by name similarity
    const { data: channelByName } = await supabase
      .from('channels')
      .select('id, name, handle_id')
      .limit(100);

    if (channelByName) {
      const match = channelByName.find(c =>
        c.handle_id?.toLowerCase().includes(handle.toLowerCase()) ||
        c.name?.toLowerCase().includes(handle.toLowerCase())
      );
      if (match) {
        return match.id;
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== Fix Empty Channel IDs ===\n');

  // Get videos with empty channel_id
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, title')
    .or('channel_id.is.null,channel_id.eq.')
    .order('uploaded_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch videos:', error);
    process.exit(1);
  }

  console.log(`Found ${videos?.length || 0} videos with empty channel_id\n`);

  if (!videos || videos.length === 0) {
    console.log('No videos to fix.');
    return;
  }

  let fixed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i] as VideoToFix;
    console.log(`[${i + 1}/${videos.length}] ${video.title.substring(0, 50)}...`);

    // Add delay to avoid rate limiting
    if (i > 0 && i % 10 === 0) {
      console.log('  [WAIT] Sleeping 2 seconds...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const channelInfo = await getChannelInfoFromOEmbed(video.id);

    if (!channelInfo) {
      skipped++;
      continue;
    }

    // Check if channel exists in our database
    const { data: channel } = await supabase
      .from('channels')
      .select('id')
      .eq('id', channelInfo.channelId)
      .single();

    if (!channel) {
      console.log(`  [SKIP] Channel ${channelInfo.channelId} (${channelInfo.channelName}) not in database`);
      skipped++;
      continue;
    }

    // Update the video
    const { error: updateError } = await supabase
      .from('videos')
      .update({ channel_id: channelInfo.channelId })
      .eq('id', video.id);

    if (updateError) {
      console.log(`  [ERROR] Failed to update: ${updateError.message}`);
      failed++;
    } else {
      console.log(`  [OK] Updated channel_id to ${channelInfo.channelId}`);
      fixed++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Fixed: ${fixed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
