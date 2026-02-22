/**
 * YouTube Transcript Proxy Worker
 * Fetches YouTube transcripts through Cloudflare to bypass IP blocking
 */

const API_KEY = 'ximya0029';

export default {
  async fetch(request, env, ctx) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Verify API key
    const apiKey = request.headers.get('X-API-Key');
    if (apiKey !== API_KEY) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Debug endpoint: /debug/:videoId
    const debugMatch = url.pathname.match(/^\/debug\/([a-zA-Z0-9_-]+)$/);
    if (debugMatch) {
      const videoId = debugMatch[1];
      const results = [];

      const clients = [
        { name: 'WEB', version: '2.20240101.00.00' },
        { name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', version: '2.0' },
        { name: 'WEB_EMBEDDED_PLAYER', version: '1.20240101' },
        { name: 'ANDROID', version: '19.02.36' },
        { name: 'IOS', version: '19.02.36' },
      ];

      for (const client of clients) {
        try {
          const apiResponse = await fetch('https://www.youtube.com/youtubei/v1/player', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoId,
              context: { client: { clientName: client.name, clientVersion: client.version, hl: 'ko', gl: 'KR' } },
            }),
          });
          const data = await apiResponse.json();
          const captions = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          results.push({
            client: client.name,
            status: data?.playabilityStatus?.status,
            reason: data?.playabilityStatus?.reason,
            captionCount: captions?.length || 0,
            captionLanguages: captions?.map(c => c.languageCode) || [],
          });
        } catch (e) {
          results.push({ client: client.name, error: e.message });
        }
      }

      return new Response(JSON.stringify(results, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Transcript endpoint: /transcript/:videoId
    const transcriptMatch = url.pathname.match(/^\/transcript\/([a-zA-Z0-9_-]+)$/);
    if (transcriptMatch) {
      const videoId = transcriptMatch[1];
      const lang = url.searchParams.get('lang') || 'ko';

      try {
        const transcript = await fetchTranscript(videoId, lang);
        return new Response(JSON.stringify({ transcript }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};

/**
 * Fetch transcript from YouTube using innertube API
 */
async function fetchTranscript(videoId, preferredLang = 'ko') {
  // Try different clients until one works
  const clients = [
    {
      name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
      version: '2.0',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    {
      name: 'WEB_EMBEDDED_PLAYER',
      version: '1.20240101',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    {
      name: 'ANDROID',
      version: '19.02.36',
      userAgent: 'com.google.android.youtube/19.02.36 (Linux; U; Android 12)',
    },
  ];

  let lastError = null;
  for (const client of clients) {
    try {
      const result = await tryFetchWithClient(videoId, client, preferredLang);
      if (result) return result;
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error('All clients failed');
}

async function tryFetchWithClient(videoId, client, preferredLang) {
  // Step 1: Call YouTube's innertube API to get video info
  const apiUrl = 'https://www.youtube.com/youtubei/v1/player';
  const apiResponse = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': client.userAgent,
    },
    body: JSON.stringify({
      videoId: videoId,
      context: {
        client: {
          clientName: client.name,
          clientVersion: client.version,
          hl: 'ko',
          gl: 'KR',
        },
      },
    }),
  });

  if (!apiResponse.ok) {
    throw new Error(`Failed to fetch video info: ${apiResponse.status}`);
  }

  const data = await apiResponse.json();

  // Check if we're blocked
  if (data?.playabilityStatus?.status === 'LOGIN_REQUIRED') {
    throw new Error('LOGIN_REQUIRED');
  }

  // Step 2: Extract caption tracks
  const captions = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!captions || captions.length === 0) {
    return null; // No captions, try next client
  }

  // Step 3: Find the best caption track
  let targetTrack = captions.find(t => t.languageCode?.startsWith(preferredLang));
  if (!targetTrack) {
    targetTrack = captions.find(t => t.languageCode?.startsWith('en'));
  }
  if (!targetTrack) {
    targetTrack = captions[0];
  }

  if (!targetTrack || !targetTrack.baseUrl) {
    return null;
  }

  // Step 4: Fetch the caption content
  const captionUrl = targetTrack.baseUrl;
  const captionResponse = await fetch(captionUrl, {
    headers: {
      'User-Agent': client.userAgent,
    },
  });

  if (!captionResponse.ok) {
    throw new Error(`Failed to fetch captions: ${captionResponse.status}`);
  }

  const captionXml = await captionResponse.text();

  // Step 5: Parse the XML and extract text
  const textMatches = captionXml.matchAll(/<text[^>]*>([^<]*)<\/text>/g);
  const texts = [];
  const seenTexts = new Set();

  for (const match of textMatches) {
    let text = match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim();

    if (text && !seenTexts.has(text)) {
      seenTexts.add(text);
      texts.push(text);
    }
  }

  return texts.join(' ').replace(/\s+/g, ' ').trim();
}
