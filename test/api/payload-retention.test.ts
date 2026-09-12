import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as upload } from '@/app/api/replays/route';
import { GET as cron } from '@/app/api/cron/prune-payloads/route';
import { POST as viewed } from '@/app/api/replays/[slug]/viewed/route';
import { getDb } from '@/lib/db';
import { clips, extensionTokens, replays, replayViews, users } from '@/lib/schema';
import { clearMemoryBlobs, getMemoryBlob, getMemoryBlobBytes, readBlobText } from '@/lib/blob';
import { isGzipBytes } from '@/lib/payloadFetch';
import { pruneReplayPayloads } from '@/lib/replayRetention';
import { eq } from 'drizzle-orm';

// B234: storage cost — payloads are stored gzip'd, and the daily prune deletes
// the blobs of replays nobody opened within the retention window.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

function payloadText(gameId: string) {
  return JSON.stringify({
    version: 2, actionCount: 10, durationMs: 1000, localPlayerId: 'p1',
    events: [{ event: 'gamestate', args: [{ full: { id: gameId, players: {
      p1: { user: { username: 'me' }, leader: { name: 'L', setId: { set: 'SOR', number: 1 } }, base: { name: 'B', setId: { set: 'SOR', number: 2 } } },
      p2: { user: { username: 'opp' } },
    } } }] }],
    tags: [],
  });
}

async function seedUser() {
  const id = randomUUID();
  const token = `kbx_${randomUUID()}`;
  await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id}@e.com` });
  await getDb().insert(extensionTokens).values({ token, userId: id });
  return { id, token };
}

async function uploadReplay(token: string, gameId = randomUUID()) {
  const res = await upload(new Request('http://t/api/replays', { method: 'POST', body: JSON.stringify({ installToken: token, payload: payloadText(gameId) }) }));
  const json = await res.json();
  expect(json.ok).toBe(true);
  return json.slug as string;
}

const DAY = 86_400_000;
async function age(slug: string, days: number) {
  await getDb().update(replays).set({ createdAt: new Date(Date.now() - days * DAY) }).where(eq(replays.slug, slug));
}
async function row(slug: string) {
  const [r] = await getDb().select().from(replays).where(eq(replays.slug, slug));
  return r;
}

beforeEach(() => { vi.mocked(auth).mockReset(); as(null); clearMemoryBlobs(); });

describe('B234 payload compression', () => {
  it('stores the upload gzip-compressed and reads it back transparently', async () => {
    const u = await seedUser();
    const slug = await uploadReplay(u.token, 'g-gz');
    const bytes = getMemoryBlobBytes(`replays/${slug}.json`)!;
    expect(isGzipBytes(bytes)).toBe(true);
    expect(bytes.length).toBeLessThan(payloadText('g-gz').length);
    // Decoded views agree with what was uploaded.
    expect(JSON.parse(getMemoryBlob(`replays/${slug}.json`)!).events[0].args[0].full.id).toBe('g-gz');
    const r = await row(slug);
    expect(r.payloadEncoding).toBe('gzip');
    expect(r.payloadSizeBytes).toBe(payloadText('g-gz').length); // raw length, unchanged semantics
    expect(JSON.parse((await readBlobText(r.payloadBlobUrl))!).events[0].args[0].full.id).toBe('g-gz');
  });
});

describe('B234 payload retention', () => {
  it('prunes only old, never-viewed, unpinned replays; keeps stats rows; marks the row', async () => {
    const u = await seedUser();
    const oldUnviewed = await uploadReplay(u.token);
    const recent = await uploadReplay(u.token);
    const oldSignedInView = await uploadReplay(u.token);
    const oldAnonView = await uploadReplay(u.token);
    const oldPublic = await uploadReplay(u.token);
    const oldClipped = await uploadReplay(u.token);
    for (const s of [oldUnviewed, oldSignedInView, oldAnonView, oldPublic, oldClipped]) await age(s, 45);

    await getDb().insert(replayViews).values({ replaySlug: oldSignedInView, userId: u.id });
    // Anonymous viewer → only last_viewed_at gets stamped.
    as(null);
    await viewed(new Request('http://t'), { params: Promise.resolve({ slug: oldAnonView }) });
    expect((await row(oldAnonView)).lastViewedAt).toBeTruthy();
    await getDb().update(replays).set({ publicAt: new Date() }).where(eq(replays.slug, oldPublic));
    await getDb().insert(clips).values({ slug: 'clip1', replaySlug: oldClipped, startFrame: 0, endFrame: 1, createdBy: u.token });

    const dry = await pruneReplayPayloads({ days: 30, dryRun: true });
    expect(dry.pruned).toBe(1);
    expect(getMemoryBlobBytes(`replays/${oldUnviewed}.json`)).toBeDefined();

    const res = await pruneReplayPayloads({ days: 30 });
    expect(res.pruned).toBe(1);
    expect(res.failedBatches).toBe(0);

    expect(getMemoryBlobBytes(`replays/${oldUnviewed}.json`)).toBeUndefined();
    const pruned = await row(oldUnviewed);
    expect(pruned.payloadPrunedAt).toBeTruthy();
    expect(pruned.payloadBlobUrl).toBeTruthy(); // URL kept for audit
    for (const s of [recent, oldSignedInView, oldAnonView, oldPublic, oldClipped]) {
      expect(getMemoryBlobBytes(`replays/${s}.json`), s).toBeDefined();
      expect((await row(s)).payloadPrunedAt).toBeNull();
    }
    // Idempotent.
    expect((await pruneReplayPayloads({ days: 30 })).pruned).toBe(0);
  });

  it('a later snapshot upload for a pruned game re-writes the blob and clears the mark', async () => {
    const u = await seedUser();
    const slug = await uploadReplay(u.token, 'g-again');
    await age(slug, 40);
    expect((await pruneReplayPayloads({ days: 30 })).pruned).toBe(1);
    expect((await row(slug)).payloadPrunedAt).toBeTruthy();
    const again = await uploadReplay(u.token, 'g-again');
    expect(again).toBe(slug);
    expect((await row(slug)).payloadPrunedAt).toBeNull();
    expect(getMemoryBlobBytes(`replays/${slug}.json`)).toBeDefined();
  });

  it('honors limit + reports more', async () => {
    const u = await seedUser();
    for (let i = 0; i < 3; i++) await age(await uploadReplay(u.token), 60);
    // Dry run with more candidates than one batch must terminate (it counts
    // instead of paging — nothing gets marked, so paging would never advance).
    const dry = await pruneReplayPayloads({ days: 30, batch: 1, dryRun: true });
    expect(dry.pruned).toBe(3);
    expect(dry.more).toBe(false);
    const res = await pruneReplayPayloads({ days: 30, limit: 2, batch: 1 });
    expect(res.pruned).toBe(2);
    expect(res.more).toBe(true);
  });
});

describe('B234 prune cron route', () => {
  it('rejects without the cron secret and runs with it', async () => {
    process.env.CRON_SECRET = 'cron-test';
    const u = await seedUser();
    await age(await uploadReplay(u.token), 90);
    expect((await cron(new Request('http://t/api/cron/prune-payloads'))).status).toBe(401);
    expect((await cron(new Request('http://t/api/cron/prune-payloads', { headers: { authorization: 'Bearer nope' } }))).status).toBe(401);
    const ok = await cron(new Request('http://t/api/cron/prune-payloads', { headers: { authorization: 'Bearer cron-test' } }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.ok).toBe(true);
    expect(body.pruned).toBe(1);
  });
});
