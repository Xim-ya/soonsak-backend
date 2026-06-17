// rate limit 영구 실패(incomplete data) 행 JSON 백업
// 사용: node scripts/backup-ratelimit-failures.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const all = [];
const PAGE = 1000;
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase
    .from('failed_videos')
    .select('*')
    .eq('is_permanently_failed', true)
    .ilike('failure_reason', '%incomplete data%')
    .range(from, from + PAGE - 1);
  if (error) throw error;
  all.push(...data);
  if (data.length < PAGE) break;
}

const out = new URL('../backup/failed-videos-ratelimit-backup-20260617.json', import.meta.url);
writeFileSync(out, JSON.stringify(all, null, 2));
console.log(`Backed up ${all.length} rows -> ${out.pathname}`);
