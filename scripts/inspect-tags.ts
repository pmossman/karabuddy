import { config } from 'dotenv';
config({ path: '.env.local' });
import { eq } from 'drizzle-orm';

async function main() {
  const { getDb } = await import('../lib/db');
  const { tags, replays } = await import('../lib/schema');
  const db = getDb();
  const slug = 'r_tvzhfe';
  const t = await db.select().from(tags).where(eq(tags.replaySlug, slug));
  console.log('tags rows:', JSON.stringify(t, null, 2));
  const r = await db.select({ payloadBlobUrl: replays.payloadBlobUrl }).from(replays).where(eq(replays.slug, slug));
  console.log('payload url:', r[0]?.payloadBlobUrl);
  if (r[0]) {
    const res = await fetch(r[0].payloadBlobUrl);
    const p = await res.json();
    console.log('tags in payload:', JSON.stringify(p.tags, null, 2));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
