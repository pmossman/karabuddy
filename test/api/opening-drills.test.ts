import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as upload } from '@/app/api/replays/route';
import { GET as poolGet } from '@/app/api/teams/[slug]/openings/route';
import { GET as itemGet, POST as itemPost } from '@/app/api/replays/[slug]/opening/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, extensionTokens, replayOpenings } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B221: Team Opening Drills — upload-time extraction, the team pool's
// anonymity/leak rules, response immutability, and the read-time response
// scoping (team overlap; owner sees all).

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

// A payload with a complete setup: pre-deal frame → dealt hand → (optional
// mulligan redraw) → 2 resources picked → action. Recorder is p1 ("Rec");
// the opponent's hand is masked (no setIds), as the real decoder guarantees.
let uu = 0;
const card = (set: string, num: number) => ({ setId: { set, number: num }, name: `${set} ${num}`, uuid: `u${uu++}` });
const masked = () => ({ uuid: `m${uu++}` });
const DEALT = () => [card('SOR', 1), card('SOR', 2), card('SHD', 10), card('SHD', 10), card('TWI', 55), card('JTL', 200)];
const REDRAWN = () => [card('SOR', 90), card('SOR', 91), card('SHD', 92), card('TWI', 93), card('JTL', 94), card('JTL', 95)];

function drillPayload(gameId: string, opts: { mulligan?: boolean } = {}) {
  const dealt = DEALT();
  const kept = opts.mulligan ? REDRAWN() : dealt;
  const resourced = [kept[1], kept[4]];
  const after = kept.filter((c) => c !== resourced[0] && c !== resourced[1]);
  const p = (piles: { hand?: any[]; resources?: any[] }, init = false) => ({
    user: { username: 'Rec' },
    hasInitiative: init,
    leader: { name: 'L', setId: { set: 'SOR', number: 5 } },
    base: { name: 'B', setId: { set: 'SOR', number: 20 } },
    cardPiles: { hand: piles.hand ?? [], resources: piles.resources ?? [] },
  });
  const opp = (hand: any[]) => ({
    user: { username: 'Opp' },
    hasInitiative: false,
    leader: { name: 'OL', setId: { set: 'TWI', number: 9 } },
    base: { name: 'OB', setId: { set: 'TWI', number: 21 } },
    cardPiles: { hand, resources: [] },
  });
  const frame = (phase: string, mine: { hand?: any[]; resources?: any[] }, oppHand: any[]) => ({
    event: 'gamestate',
    args: [{ full: { id: gameId, phase, players: { p1: p(mine, true), p2: opp(oppHand) } } }],
  });
  const frames = [
    frame('setup', {}, []),
    frame('setup', { hand: dealt }, Array(6).fill(0).map(masked)),
    ...(opts.mulligan ? [frame('setup', { hand: kept }, Array(6).fill(0).map(masked))] : []),
    frame('setup', { hand: after, resources: resourced }, Array(6).fill(0).map(masked)),
    frame('action', { hand: after, resources: resourced }, Array(4).fill(0).map(masked)),
  ];
  return {
    payload: JSON.stringify({ version: 2, actionCount: 10, durationMs: 1000, localPlayerId: 'p1', events: frames, tags: [] }),
    resourcedIds: resourced.map((c) => `${c.setId.set}_${String(c.setId.number).padStart(3, '0')}`),
    keptIds: kept.map((c) => `${c.setId.set}_${String(c.setId.number).padStart(3, '0')}`),
  };
}

async function seedUser(name?: string) {
  const id = randomUUID();
  const token = `kbx_${randomUUID()}`;
  await getDb().insert(users).values({ id, name: name ?? id.slice(0, 4), email: `${id}@e.com` });
  await getDb().insert(extensionTokens).values({ token, userId: id });
  return { id, token };
}
async function seedTeam(owner: string, members: string[]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: owner });
  await getDb().insert(teamMembers).values(members.map((u) => ({ teamSlug: slug, userId: u, role: u === owner ? 'owner' : 'member' })));
  return slug;
}
const doUpload = async (token: string, gameId: string, share: string[], opts: { mulligan?: boolean } = {}) => {
  const { payload, resourcedIds, keptIds } = drillPayload(gameId, opts);
  const res = await upload(new Request('http://t/api/replays', { method: 'POST', body: JSON.stringify({ installToken: token, payload, shareTeamSlugs: share }) }));
  const j = await res.json();
  return { slug: j.slug as string, resourcedIds, keptIds };
};
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const pool = async (team: string, qs = '') => (await (await poolGet(new Request(`http://t/api/teams/${team}/openings${qs}`), params(team))).json()).data as any[];
const item = async (slug: string) => (await itemGet(new Request('http://t'), params(slug))).json();
const respond = async (slug: string, decision: string, resourced: string[]) =>
  (await itemPost(new Request('http://t', { method: 'POST', body: JSON.stringify({ decision, resourced }) }), params(slug))).json();

beforeEach(() => vi.mocked(auth).mockReset());

describe('B221 opening drills', () => {
  it('extracts an opening row on upload (keep + mulligan variants)', async () => {
    const a = await seedUser();
    const team = await seedTeam(a.id, [a.id]);
    as(a.id);
    const keep = await doUpload(a.token, `g-${randomUUID()}`, [team]);
    const mull = await doUpload(a.token, `g-${randomUUID()}`, [team], { mulligan: true });
    const [keepRow] = await getDb().select().from(replayOpenings).where(eq(replayOpenings.replaySlug, keep.slug));
    const [mullRow] = await getDb().select().from(replayOpenings).where(eq(replayOpenings.replaySlug, mull.slug));
    expect(keepRow.decision).toBe('keep');
    expect(keepRow.resourced).toEqual(keep.resourcedIds);
    expect(keepRow.wentFirst).toBe(true);
    expect(mullRow.decision).toBe('mulligan');
    expect(mullRow.keptHand).toEqual(mull.keptIds);
  });

  it('pool: anonymized for teammates, reveal-gated tallies, identity on own items', async () => {
    const a = await seedUser('Aster');
    const b = await seedUser('Boba');
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id);
    await doUpload(a.token, `g-${randomUUID()}`, [team]);

    as(b.id);
    const forB = await pool(team);
    expect(forB).toHaveLength(1);
    expect(forB[0].mine).toBe(false);
    expect(forB[0].answered).toBe(false);
    expect(forB[0].recorder).toBeUndefined(); // anonymity
    expect(forB[0].recordedDecision).toBeUndefined(); // no answer leak
    expect(forB[0].ownLeader?.set).toBe('SOR'); // matchup context IS present
    expect(forB[0].oppLeader?.set).toBe('TWI');

    as(a.id);
    const forA = await pool(team);
    expect(forA[0].mine).toBe(true);
    expect(forA[0].recorder?.userId).toBe(a.id); // uploader view
    expect(forA[0].recordedDecision).toBe('keep');
    expect(forA[0].myDecision).toBeUndefined(); // owner has no answer
  });

  it('pool: an answered item carries the viewer\'s own outcome (glyph data)', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id);
    const { slug, keptIds, resourcedIds } = await doUpload(a.token, `g-${randomUUID()}`, [team]);
    as(b.id);
    // Pick one of their actual picks + one miss → 1/2 matched, decision differs.
    const miss = keptIds.find((id) => !resourcedIds.includes(id))!;
    await respond(slug, 'mulligan', [resourcedIds[0], miss]);
    const [item] = await pool(team);
    expect(item.myDecision).toBe('mulligan');
    expect(item.recordedDecision).toBe('keep');
    expect(item.myPickMatches).toBe(1);
    // Answered rows carry the reveal-tier identity + dates.
    expect(item.usernames).toEqual({ own: 'Rec', opp: 'Opp' });
    expect(item.recorder?.userId).toBe(a.id);
    expect(typeof item.myAnsweredAt).toBe('string');
  });

  it('a KEEP answer on a mulligan game picks from the DEALT hand (the fork data)', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id);
    const { slug, keptIds } = await doUpload(a.token, `g-${randomUUID()}`, [team], { mulligan: true });
    const dealtIds = DEALT().map((c) => `${c.setId.set}_${String(c.setId.number).padStart(3, '0')}`);
    as(b.id);
    // Redraw-only cards are NOT valid for a keep answer…
    expect((await respond(slug, 'keep', [keptIds[0], keptIds[1]])).error).toMatch(/not in hand/);
    // …dealt-hand cards are.
    const ok = await respond(slug, 'keep', [dealtIds[0], dealtIds[2]]);
    expect(ok.ok).toBe(true);
    // Different hands → the pick overlap is NOT comparable (glyph shows divergence).
    const [item] = await pool(team);
    expect(item.myDecision).toBe('keep');
    expect(item.recordedDecision).toBe('mulligan');
    expect(item.myPickMatches).toBeNull();
  });

  it('pool: the teammate filter reveals identity (coaching mode)', async () => {
    const a = await seedUser('Aster');
    const b = await seedUser('Boba');
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id);
    await doUpload(a.token, `g-${randomUUID()}`, [team]);
    as(b.id);
    const filtered = await pool(team, `?recorder=${a.id}`);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].recorder?.userId).toBe(a.id);
    expect(await pool(team, `?recorder=${b.id}`)).toHaveLength(0);
  });

  it('pool: member-only', async () => {
    const a = await seedUser();
    const c = await seedUser();
    const team = await seedTeam(a.id, [a.id]);
    as(c.id);
    expect((await poolGet(new Request('http://t'), params(team))).status).toBe(403);
    as(null);
    expect((await poolGet(new Request('http://t'), params(team))).status).toBe(401);
  });

  it('item: quiz payload has hands but no reveal until answered; POST returns the reveal', async () => {
    const a = await seedUser('Aster');
    const b = await seedUser('Boba');
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id);
    const { slug, resourcedIds, keptIds } = await doUpload(a.token, `g-${randomUUID()}`, [team]);

    as(b.id);
    const before = (await item(slug)).data;
    expect(before.dealtHand).toHaveLength(6);
    expect(before.keptHand.map((c: any) => c.id)).toEqual(keptIds);
    expect(before.reveal).toBeUndefined();
    expect(before.answered).toBe(false);

    const picks = [keptIds[0], keptIds[2]];
    const after = (await respond(slug, 'mulligan', picks)).data;
    expect(after.answered).toBe(true);
    expect(after.myResponse).toEqual({ decision: 'mulligan', resourced: picks });
    expect(after.reveal.decision).toBe('keep');
    expect(after.reveal.resourced.map((c: any) => c.id)).toEqual(resourcedIds);
    expect(after.reveal.recorder.userId).toBe(a.id); // identity IS the reveal
    expect(after.reveal.responses.map((r: any) => r.userId)).toEqual([b.id]);
  });

  it('responses are immutable — a re-POST cannot change the stored answer', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id);
    const { slug, keptIds } = await doUpload(a.token, `g-${randomUUID()}`, [team]);
    as(b.id);
    await respond(slug, 'keep', [keptIds[0], keptIds[1]]);
    const second = (await respond(slug, 'mulligan', [keptIds[2], keptIds[3]])).data;
    expect(second.myResponse).toEqual({ decision: 'keep', resourced: [keptIds[0], keptIds[1]] });
  });

  it('validates the picks: exactly 2, from the kept hand, duplicates need copies', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id);
    const { slug, keptIds } = await doUpload(a.token, `g-${randomUUID()}`, [team]);
    as(b.id);
    expect((await respond(slug, 'keep', [keptIds[0]])).error).toMatch(/2 resources/);
    expect((await respond(slug, 'keep', ['XXX_001', keptIds[0]])).error).toMatch(/not in hand/);
    // SHD_010 has two copies in the dealt hand — picking it twice is legal…
    expect((await respond(slug, 'keep', ['SHD_010', 'SHD_010'])).ok).toBe(true);
    // …but a single-copy card twice is not (fresh responder).
    const c = await seedUser();
    await getDb().insert(teamMembers).values({ teamSlug: team, userId: c.id, role: 'member' });
    as(c.id);
    expect((await respond(slug, 'keep', ['SOR_001', 'SOR_001'])).error).toMatch(/not in hand/);
  });

  it('the owner cannot answer their own opening', async () => {
    const a = await seedUser();
    const team = await seedTeam(a.id, [a.id]);
    as(a.id);
    const { slug, keptIds } = await doUpload(a.token, `g-${randomUUID()}`, [team]);
    const res = await itemPost(new Request('http://t', { method: 'POST', body: JSON.stringify({ decision: 'keep', resourced: [keptIds[0], keptIds[1]] }) }), params(slug));
    expect(res.status).toBe(403);
    // …but they DO see the reveal + distribution on GET (uploader view).
    const mine = (await item(slug)).data;
    expect(mine.isOwner).toBe(true);
    expect(mine.reveal).toBeDefined();
  });

  it('entitlement: a stranger (no shared team) gets 404', async () => {
    const a = await seedUser();
    const c = await seedUser();
    const team = await seedTeam(a.id, [a.id]);
    as(a.id);
    const { slug } = await doUpload(a.token, `g-${randomUUID()}`, [team]);
    as(c.id);
    expect((await itemGet(new Request('http://t'), params(slug))).status).toBe(404);
  });

  it('response distribution is scoped to the viewer\'s shared teams; the owner sees all', async () => {
    const a = await seedUser('Aster');
    const b = await seedUser('Boba');
    const c = await seedUser('Cass');
    const team1 = await seedTeam(a.id, [a.id, b.id]);
    const team2 = await seedTeam(a.id, [a.id, c.id]);
    as(a.id);
    const { slug, keptIds } = await doUpload(a.token, `g-${randomUUID()}`, [team1, team2]);

    as(b.id);
    await respond(slug, 'keep', [keptIds[0], keptIds[1]]);
    as(c.id);
    await respond(slug, 'mulligan', [keptIds[2], keptIds[3]]);

    // B (team1 only) sees their own answer but NOT C's (team2).
    as(b.id);
    const forB = (await item(slug)).data;
    expect(forB.reveal.responses.map((r: any) => r.userId).sort()).toEqual([b.id]);

    // The owner sees both.
    as(a.id);
    const forA = (await item(slug)).data;
    expect(forA.reveal.responses.map((r: any) => r.userId).sort()).toEqual([b.id, c.id].sort());
  });
});
