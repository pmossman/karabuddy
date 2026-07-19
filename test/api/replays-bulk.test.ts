import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as bulkOp } from '@/app/api/replays/bulk/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares, tags, tagTeamScope } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';

// Bulk replay operations — one endpoint that applies an individual-level op to a
// SET of replays, re-running the SAME per-item permission check the single-item
// route does (canMutateReplay), and reporting partial success. The headline use
// is bulk share-to-team; the team-tab use is bulk unshare of your own replays.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (userId: string | null) => vi.mocked(auth).mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: 'U', email: `${id}@e.com` });
  return id;
}
async function seedTeam(owner: string, members: string[] = [owner], opts: { privateMode?: boolean; teamKeyId?: string } = {}) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: owner, privateMode: opts.privateMode ?? false, teamKeyId: opts.teamKeyId ?? null });
  await getDb().insert(teamMembers).values(members.map((userId) => ({ teamSlug: slug, userId, role: userId === owner ? 'owner' : 'member' })));
  return slug;
}
async function seedReplay(ownerUserId: string | null, opts: { ownerToken?: string; encrypted?: boolean; teamKeyId?: string } = {}) {
  const slug = randomUUID().slice(0, 8);
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId: ownerUserId, ownerToken: opts.ownerToken ?? `kbx_${randomUUID()}`,
    players: [{ username: 'A' }], payloadBlobUrl: `https://blob.test/${slug}.json`,
    encrypted: opts.encrypted ?? false, teamKeyId: opts.teamKeyId ?? null, encryptedSummary: opts.encrypted ? '{}' : null,
  });
  return slug;
}
async function seedTag(replaySlug: string, teamSlug?: string) {
  const id = randomUUID();
  await getDb().insert(tags).values({ id, replaySlug, frameIndex: 0, authorToken: `kbx_${randomUUID()}`, authorName: 'A' });
  if (teamSlug) await getDb().insert(tagTeamScope).values({ tagId: id, teamSlug });
  return id;
}

const bulk = (op: string, slugs: unknown, extra: Record<string, unknown> = {}, token?: string) =>
  bulkOp(new Request('http://t', {
    method: 'POST',
    headers: token ? { 'x-install-token': token } : {},
    body: JSON.stringify({ op, slugs, ...extra }),
  }));
const sharesOf = (slug: string) => getDb().select().from(replayTeamShares).where(eq(replayTeamShares.replaySlug, slug));
const rowOf = async (slug: string) => (await getDb().select().from(replays).where(eq(replays.slug, slug)).limit(1))[0];

beforeEach(() => vi.mocked(auth).mockReset());

describe('POST /api/replays/bulk — delete', () => {
  it('deletes my replays, leaves others (forbidden) and missing (notFound) — partial success', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const r1 = await seedReplay(me);
    const r2 = await seedReplay(me);
    const r3 = await seedReplay(other); // not mine
    as(me);
    const res = await bulk('delete', [r1, r2, r3, 'nope']);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toBe(2);
    expect(body.results.ok.sort()).toEqual([r1, r2].sort());
    expect(body.results.forbidden).toEqual([r3]);
    expect(body.results.notFound).toEqual(['nope']);
    expect(await rowOf(r1)).toBeUndefined();
    expect(await rowOf(r3)).toBeDefined(); // other's replay untouched
  });

  it('an anonymous owner can bulk-delete via X-Install-Token', async () => {
    const token = `kbx_${randomUUID()}`;
    const r1 = await seedReplay(null, { ownerToken: token });
    as(null);
    const body = await (await bulk('delete', [r1], {}, token)).json();
    expect(body.applied).toBe(1);
    expect(await rowOf(r1)).toBeUndefined();
  });
});

describe('POST /api/replays/bulk — publish / unpublish', () => {
  it('publishes a set; unpublish clears it', async () => {
    const me = await seedUser();
    const r1 = await seedReplay(me);
    const r2 = await seedReplay(me);
    as(me);
    expect((await (await bulk('publish', [r1, r2])).json()).applied).toBe(2);
    expect((await rowOf(r1)).publicAt).toBeTruthy();
    expect((await rowOf(r2)).publicAt).toBeTruthy();
    await bulk('unpublish', [r1]);
    expect((await rowOf(r1)).publicAt).toBeNull();
    expect((await rowOf(r2)).publicAt).toBeTruthy();
  });

  it('skips encrypted replays when publishing (they can never be public)', async () => {
    const me = await seedUser();
    const r1 = await seedReplay(me);
    const rE = await seedReplay(me, { encrypted: true, teamKeyId: 'kid1' });
    as(me);
    const body = await (await bulk('publish', [r1, rE])).json();
    expect(body.results.ok).toEqual([r1]);
    expect(body.results.skipped).toEqual([rE]);
    expect((await rowOf(rE)).publicAt).toBeNull();
  });
});

describe('POST /api/replays/bulk — share', () => {
  it('owner+member shares a set to a team, idempotently', async () => {
    const me = await seedUser();
    const team = await seedTeam(me);
    const r1 = await seedReplay(me);
    const r2 = await seedReplay(me);
    as(me);
    expect((await (await bulk('share', [r1, r2], { teamSlug: team })).json()).applied).toBe(2);
    expect((await (await bulk('share', [r1, r2], { teamSlug: team })).json()).applied).toBe(2); // idempotent re-run
    expect(await sharesOf(r1)).toHaveLength(1);
  });

  it('403 when the caller is not a member of the target team', async () => {
    const me = await seedUser();
    const stranger = await seedUser();
    const foreign = await seedTeam(stranger); // me is NOT a member
    const r1 = await seedReplay(me);
    as(me);
    expect((await bulk('share', [r1], { teamSlug: foreign })).status).toBe(403);
  });

  it('forbids non-owned replays and skips ones incompatible with the team', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const priv = await seedTeam(me, [me], { privateMode: true, teamKeyId: 'kid1' });
    const mine = await seedReplay(me); // plaintext → cannot enter a private team
    const theirs = await seedReplay(other);
    as(me);
    const body = await (await bulk('share', [mine, theirs], { teamSlug: priv })).json();
    expect(body.results.forbidden).toEqual([theirs]);
    expect(body.results.skipped).toEqual([mine]);
    expect(body.applied).toBe(0);
    expect(await sharesOf(mine)).toHaveLength(0);
  });
});

describe('POST /api/replays/bulk — unshare', () => {
  it('removes shares for the set and strips that team from the replay’s tag scopes', async () => {
    const me = await seedUser();
    const team = await seedTeam(me);
    const r1 = await seedReplay(me);
    as(me);
    await bulk('share', [r1], { teamSlug: team });
    const tagId = await seedTag(r1, team); // a tag scoped to the team
    const body = await (await bulk('unshare', [r1], { teamSlug: team })).json();
    expect(body.applied).toBe(1);
    expect(await sharesOf(r1)).toHaveLength(0);
    expect(await getDb().select().from(tagTeamScope).where(eq(tagTeamScope.tagId, tagId))).toHaveLength(0);
  });
});

describe('POST /api/replays/bulk — labels', () => {
  it('adds a label (idempotent), removes it, and skips encrypted replays', async () => {
    const me = await seedUser();
    const r1 = await seedReplay(me);
    const r2 = await seedReplay(me);
    const rE = await seedReplay(me, { encrypted: true, teamKeyId: 'kid1' });
    as(me);
    const add = await (await bulk('label-add', [r1, r2, rE], { label: 'Aggro' })).json();
    expect(add.results.ok.sort()).toEqual([r1, r2].sort());
    expect(add.results.skipped).toEqual([rE]); // encrypted labels live in the E2EE summary
    expect((await rowOf(r1)).labels).toEqual(['Aggro']);
    // idempotent — re-adding doesn't duplicate
    await bulk('label-add', [r1], { label: 'Aggro' });
    expect((await rowOf(r1)).labels).toEqual(['Aggro']);
    // remove (case-insensitive) clears it back to null
    await bulk('label-remove', [r1, r2], { label: 'aggro' });
    expect((await rowOf(r1)).labels).toBeNull();
  });

  it('400 without a label', async () => {
    const me = await seedUser();
    const r1 = await seedReplay(me);
    as(me);
    expect((await bulk('label-add', [r1])).status).toBe(400);
  });
});

describe('POST /api/replays/bulk — request / cancel review', () => {
  const shareRow = (slug: string, team: string) => getDb().select().from(replayTeamShares)
    .where(and(eq(replayTeamShares.replaySlug, slug), eq(replayTeamShares.teamSlug, team)));

  it('requests review on shared replays, skips unshared ones, then cancels', async () => {
    const me = await seedUser();
    const team = await seedTeam(me);
    const shared = await seedReplay(me);
    const unshared = await seedReplay(me);
    as(me);
    await bulk('share', [shared], { teamSlug: team });

    const req = await (await bulk('review-request', [shared, unshared], { teamSlug: team })).json();
    expect(req.results.ok).toEqual([shared]);
    expect(req.results.skipped).toEqual([unshared]); // not shared with the team
    const [row] = await shareRow(shared, team);
    expect(row.reviewRequestedAt).toBeTruthy();
    expect(row.reviewRequestedBy).toBe(me);

    await bulk('review-cancel', [shared], { teamSlug: team });
    const [after] = await shareRow(shared, team);
    expect(after.reviewRequestedAt).toBeNull();
  });
});

describe('POST /api/replays/bulk — validation', () => {
  it('rejects bad op, empty slugs, share without teamSlug, and signed-out share', async () => {
    const me = await seedUser();
    const r1 = await seedReplay(me);
    as(me);
    expect((await bulk('frobnicate', [r1])).status).toBe(400);
    expect((await bulk('delete', [])).status).toBe(400);
    expect((await bulk('share', [r1])).status).toBe(400); // no teamSlug
    as(null);
    expect((await bulk('share', [r1], { teamSlug: 'x' })).status).toBe(401);
  });
});

// Manual result assignment (karabast "leave game" leaves winners null). The op
// writes `winners` from the owner's POV + the winnerManual flag; stats re-persist
// is best-effort (mocked away here — the payload fetch is exercised at the
// integration layer). These assert the column state + per-item gating.
async function seedScorable(ownerUserId: string | null, pov: string, oppId: string, token?: string) {
  const slug = randomUUID().slice(0, 8);
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId: ownerUserId, ownerToken: token ?? `kbx_${randomUUID()}`,
    players: [{ id: pov, username: 'Me' }, { id: oppId, username: 'Opp' }],
    ownerPlayerId: pov, payloadBlobUrl: `https://blob.test/${slug}.json`, encrypted: false,
  });
  return slug;
}

describe('POST /api/replays/bulk — result assignment', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 })));
  afterEach(() => vi.unstubAllGlobals());

  it('result-win sets winners to the owner + marks it manual', async () => {
    const u = await seedUser(); as(u);
    const pov = randomUUID(), opp = randomUUID();
    const slug = await seedScorable(u, pov, opp);
    const body = await (await bulk('result-win', [slug])).json();
    expect(body.applied).toBe(1);
    const row = await rowOf(slug);
    expect(row.winners).toEqual([pov]);
    expect(row.winnerManual).toBe(true);
    expect(row.resultSetAt).toBeTruthy();
  });

  it('result-loss sets winners to the opponent', async () => {
    const u = await seedUser(); as(u);
    const pov = randomUUID(), opp = randomUUID();
    const slug = await seedScorable(u, pov, opp);
    await bulk('result-loss', [slug]);
    const row = await rowOf(slug);
    expect(row.winners).toEqual([opp]);
    expect(row.winnerManual).toBe(true);
  });

  it('result-clear nulls the result + unmarks manual', async () => {
    const u = await seedUser(); as(u);
    const pov = randomUUID(), opp = randomUUID();
    const slug = await seedScorable(u, pov, opp);
    await bulk('result-win', [slug]);
    await bulk('result-clear', [slug]);
    const row = await rowOf(slug);
    expect(row.winners).toBeNull();
    expect(row.winnerManual).toBe(false);
  });

  it('forbids assigning a result to a replay you do not own', async () => {
    const owner = await seedUser(); const other = await seedUser(); as(other);
    const pov = randomUUID(), opp = randomUUID();
    const slug = await seedScorable(owner, pov, opp);
    const body = await (await bulk('result-win', [slug])).json();
    expect(body.applied).toBe(0);
    expect(body.results.forbidden).toContain(slug);
    expect((await rowOf(slug)).winners).toBeNull();
  });

  it('skips encrypted replays (payload unreadable server-side)', async () => {
    const u = await seedUser(); as(u);
    const slug = await seedReplay(u, { encrypted: true });
    const body = await (await bulk('result-win', [slug])).json();
    expect(body.results.skipped).toContain(slug);
  });

  it('skips a game with no opponent id (can\'t score a loss)', async () => {
    const u = await seedUser(); as(u);
    const pov = randomUUID();
    const slug = randomUUID().slice(0, 8);
    await getDb().insert(replays).values({
      slug, gameId: randomUUID(), userId: u, ownerToken: `kbx_${randomUUID()}`,
      players: [{ id: pov, username: 'Me' }], ownerPlayerId: pov,
      payloadBlobUrl: `https://blob.test/${slug}.json`, encrypted: false,
    });
    const body = await (await bulk('result-loss', [slug])).json();
    expect(body.results.skipped).toContain(slug);
    expect((await rowOf(slug)).winners).toBeNull();
  });
});
