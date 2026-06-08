import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as upload } from '@/app/api/replays/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, tags, replayTeamShares, tagTeamScope } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B79: integration coverage for the upload + upsert path — the biggest
// previously-untested surface (dedupe, stale-snapshot guard, winner
// extraction, tag-lifting, shares-on-upload + scope).

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const mockedAuth = vi.mocked(auth);
const as = (userId: string | null) => mockedAuth.mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));

function replayPayload(over: any = {}) {
  const full: any = {
    id: over.gameId ?? 'game-1',
    players: {
      p1: { user: { username: 'Alice' }, leader: { name: 'L', setId: { set: 'SOR', number: 1 } }, base: { name: 'B', setId: { set: 'SOR', number: 2 } } },
      p2: { user: { username: 'Bob' } },
    },
  };
  if (over.winners) full.winners = over.winners;
  return JSON.stringify({
    version: 2,
    actionCount: over.actionCount ?? 10,
    durationMs: 1000,
    localPlayerId: 'p1',
    events: [{ event: 'gamestate', args: [{ full }] }],
    tags: over.tags ?? [],
  });
}
const doUpload = (installToken: string, payloadOver: any = {}, extra: any = {}) =>
  upload(new Request('http://test/api/replays', {
    method: 'POST',
    body: JSON.stringify({ installToken, payload: replayPayload(payloadOver), ...extra }),
  }));

beforeEach(() => mockedAuth.mockReset());

describe('POST /api/replays — validation', () => {
  it('400s without installToken / payload, and on bad payloads', async () => {
    as(null);
    expect((await upload(new Request('http://t', { method: 'POST', body: '{}' }))).status).toBe(400);
    expect((await upload(new Request('http://t', { method: 'POST', body: JSON.stringify({ installToken: 'k' }) }))).status).toBe(400);
    const badJson = await upload(new Request('http://t', { method: 'POST', body: JSON.stringify({ installToken: 'k', payload: 'not json' }) }));
    expect(badJson.status).toBe(400);
    const badVer = await upload(new Request('http://t', { method: 'POST', body: JSON.stringify({ installToken: 'k', payload: JSON.stringify({ version: 9, events: [] }) }) }));
    expect(badVer.status).toBe(400);
  });
});

describe('POST /api/replays — new upload', () => {
  it('creates a replay row, serializes players, and lifts payload tags', async () => {
    as(null);
    const res = await doUpload('kbx_a', { tags: [{ id: 't1', frameIndex: 3, comment: 'nice', author: 'Alice' }] });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const [row] = await getDb().select().from(replays).where(eq(replays.gameId, 'game-1'));
    expect(row.slug).toBe(body.slug);
    expect((row.players as any[]).map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(row.ownerPlayerId).toBe('p1');
    const tagRows = await getDb().select().from(tags).where(eq(tags.replaySlug, row.slug));
    expect(tagRows).toHaveLength(1);
    expect(tagRows[0].comment).toBe('nice');
  });

  it('extracts + normalizes the winner username to a playerId', async () => {
    as(null);
    const res = await doUpload('kbx_a', { gameId: 'game-win', winners: ['Alice'] });
    const { slug } = await res.json();
    const [row] = await getDb().select().from(replays).where(eq(replays.slug, slug));
    expect(row.winners).toEqual(['p1']); // 'Alice' → p1
  });
});

describe('POST /api/replays — upsert by gameId', () => {
  it('same owner re-upload overwrites + refreshes metadata (one row)', async () => {
    as(null);
    await doUpload('kbx_a', { gameId: 'g', actionCount: 5 });
    const res2 = await doUpload('kbx_a', { gameId: 'g', actionCount: 12 });
    const body2 = await res2.json();
    expect(body2.snapshot).toBe(true);
    const rows = await getDb().select().from(replays).where(eq(replays.gameId, 'g'));
    expect(rows).toHaveLength(1);
    expect(rows[0].actionCount).toBe(12);
  });

  it('rejects a stale snapshot (fewer actions than saved) without overwriting', async () => {
    as(null);
    await doUpload('kbx_a', { gameId: 'g2', actionCount: 20 });
    const res = await doUpload('kbx_a', { gameId: 'g2', actionCount: 8 });
    expect((await res.json()).staleSnapshot).toBe(true);
    const [row] = await getDb().select().from(replays).where(eq(replays.gameId, 'g2'));
    expect(row.actionCount).toBe(20); // unchanged
  });

  it('a different owner uploading the same gameId is deduped to the original', async () => {
    as(null);
    const first = await (await doUpload('kbx_owner', { gameId: 'g3' })).json();
    const second = await (await doUpload('kbx_other', { gameId: 'g3' })).json();
    expect(second.deduped).toBe(true);
    expect(second.slug).toBe(first.slug);
    const [row] = await getDb().select().from(replays).where(eq(replays.gameId, 'g3'));
    expect(row.ownerToken).toBe('kbx_owner'); // original ownership preserved
  });
});

describe('POST /api/replays — B114 client metadata', () => {
  it('stores sanitized clientMeta on insert and refreshes it on snapshot', async () => {
    as(null);
    await doUpload('kbx_cm', { gameId: 'gcm', actionCount: 5 }, { clientMeta: { extVersion: '0.5.12', browser: 'chrome', ua: 'UA1', evil: 'drop-me' } });
    let [row] = await getDb().select().from(replays).where(eq(replays.gameId, 'gcm'));
    expect(row.clientMeta).toEqual({ extVersion: '0.5.12', browser: 'chrome', ua: 'UA1' }); // unknown key dropped

    // a later snapshot from a newer build refreshes it (latest wins)
    await doUpload('kbx_cm', { gameId: 'gcm', actionCount: 12 }, { clientMeta: { extVersion: '0.5.13', browser: 'chrome', ua: 'UA1' } });
    [row] = await getDb().select().from(replays).where(eq(replays.gameId, 'gcm'));
    expect((row.clientMeta as any).extVersion).toBe('0.5.13');
  });

  it('does not null an existing clientMeta when an upload omits it', async () => {
    as(null);
    await doUpload('kbx_cm2', { gameId: 'gcm2', actionCount: 5 }, { clientMeta: { extVersion: '0.5.12' } });
    await doUpload('kbx_cm2', { gameId: 'gcm2', actionCount: 9 }); // no clientMeta (e.g. older build)
    const [row] = await getDb().select().from(replays).where(eq(replays.gameId, 'gcm2'));
    expect((row.clientMeta as any).extVersion).toBe('0.5.12'); // preserved
  });

  it('leaves clientMeta null when none is sent', async () => {
    as(null);
    await doUpload('kbx_cm3', { gameId: 'gcm3' });
    const [row] = await getDb().select().from(replays).where(eq(replays.gameId, 'gcm3'));
    expect(row.clientMeta).toBeNull();
  });
});

describe('POST /api/replays — armed shares + lifted-tag scope', () => {
  it('applies the bubble armed teams as shares and scopes lifted tags to them', async () => {
    const u = randomUUID();
    await getDb().insert(users).values({ id: u, name: 'U', email: `${u}@e.com` });
    await getDb().insert(teams).values({ slug: 'sq', name: 'Squad', createdBy: u });
    await getDb().insert(teamMembers).values({ teamSlug: 'sq', userId: u, role: 'owner' });
    as(u);

    const res = await doUpload('kbx_u', { gameId: 'g4', tags: [{ id: 'lt1', frameIndex: 2, comment: 'hi', author: 'U' }] }, { shareTeamSlugs: ['sq'] });
    const { slug } = await res.json();

    const shares = await getDb().select().from(replayTeamShares).where(eq(replayTeamShares.replaySlug, slug));
    expect(shares.map((s) => s.teamSlug)).toEqual(['sq']);
    const scope = await getDb().select().from(tagTeamScope).where(eq(tagTeamScope.tagId, 'lt1'));
    expect(scope.map((s) => s.teamSlug)).toEqual(['sq']); // lifted tag defaulted to the share
  });

  it('ignores armed teams the uploader is not a member of', async () => {
    const u = randomUUID();
    await getDb().insert(users).values({ id: u, name: 'U2', email: `${u}@e.com` });
    as(u);
    const res = await doUpload('kbx_u2', { gameId: 'g5' }, { shareTeamSlugs: ['not-mine'] });
    const { slug } = await res.json();
    const shares = await getDb().select().from(replayTeamShares).where(eq(replayTeamShares.replaySlug, slug));
    expect(shares).toHaveLength(0);
  });
});
