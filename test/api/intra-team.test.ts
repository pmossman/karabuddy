import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as upload } from '@/app/api/replays/route';
import { GET as teamReplays } from '@/app/api/teams/[slug]/replays/route';
import { teamGameIds } from '@/lib/teamSurface';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, extensionTokens, replayParticipants, replays } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B84/B166: account-based intra-team detection. A match is "internal" when ≥2 of
// its RECORDERS (now independent per-recorder rows, grouped by gameId) are
// members of this team — no karabast usernames involved.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

function payload(gameId: string) {
  return JSON.stringify({
    version: 2, actionCount: 10, durationMs: 1000, localPlayerId: 'p1',
    events: [{ event: 'gamestate', args: [{ full: { id: gameId, players: {
      p1: { user: { username: 'whatever' }, leader: { name: 'L', setId: { set: 'SOR', number: 1 } }, base: { name: 'B', setId: { set: 'SOR', number: 2 } } },
      p2: { user: { username: 'opp' } },
    } } }] }],
    tags: [],
  });
}
const doUpload = (token: string, gameId: string, shareTeamSlugs?: string[]) =>
  upload(new Request('http://t/api/replays', { method: 'POST', body: JSON.stringify({ installToken: token, payload: payload(gameId), ...(shareTeamSlugs ? { shareTeamSlugs } : {}) }) }));

async function seedUser() {
  const id = randomUUID();
  const token = `kbx_${randomUUID()}`;
  await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id}@e.com` });
  await getDb().insert(extensionTokens).values({ token, userId: id });
  return { id, token };
}
async function seedTeam(owner: string, members: string[]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: owner });
  await getDb().insert(teamMembers).values(members.map((u) => ({ teamSlug: slug, userId: u, role: u === owner ? 'owner' : 'member' })));
  return slug;
}
const teamParams = (slug: string) => ({ params: Promise.resolve({ slug }) });
const listInternal = async (slug: string, gameId: string) => {
  const data = (await (await teamReplays(new Request('http://t'), teamParams(slug))).json()).data as any[];
  return data.find((r) => r.gameId === gameId)?.internal;
};

beforeEach(() => vi.mocked(auth).mockReset());

describe('account-based intra-team detection', () => {
  it('records each uploader as a participant (no karabast username involved)', async () => {
    const a = await seedUser();
    as(a.id);
    const { slug } = await (await doUpload(a.token, 'g-part')).json();
    const parts = await getDb().select().from(replayParticipants).where(eq(replayParticipants.replaySlug, slug));
    expect(parts.map((p) => p.userId)).toEqual([a.id]);
  });

  it('flags a match internal when two teammates both recorded it', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id); await doUpload(a.token, 'g-int', [team]);       // A records + shares with the team
    as(b.id); await doUpload(b.token, 'g-int');               // B records same match (own row, B166)
    as(a.id);
    expect(await listInternal(team, 'g-int')).toBe(true);
  });

  it('is NOT internal when only one teammate recorded', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id); await doUpload(a.token, 'g-solo', [team]);
    as(a.id);
    expect(await listInternal(team, 'g-solo')).toBe(false);
  });

  // B166: stats partition must count a co-recorded game ONCE (one representative
  // slug per gameId), not once per recorder row — else internal games both
  // misclassify and double-count.
  it('teamGameIds: a co-recorded game is internal and counted once', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id); await doUpload(a.token, 'g-tgs-int', [team]);
    as(b.id); await doUpload(b.token, 'g-tgs-int');     // own row, not shared
    const sets = await teamGameIds(team);
    expect(sets.internal).toHaveLength(1);              // counted once, not twice
    expect(sets.external).toHaveLength(0);
  });

  it('teamGameIds: a solo-recorded game is external', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id); await doUpload(a.token, 'g-tgs-ext', [team]);
    const sets = await teamGameIds(team);
    expect(sets.internal).toHaveLength(0);
    expect(sets.external).toHaveLength(1);
  });
});

// B187: the team replays grid must window by distinct GAME, not raw row. The old
// `.limit(200)` capped the 200 most-recent surfaced ROWS, so once a team passed
// ~100 games its older shared replays silently fell off (and B166 co-recording —
// two rows per game — halved the window). A real CCC team hit this at 1014 shared
// games → only ~the last two days showed despite the shares still existing.
describe('team replays grid windows by game (B187)', () => {
  it('caps by distinct GAME (newest kept, co-records collapse to one slot, not row-limited)', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    // four games, oldest→newest, all explicitly shared with the team
    for (const g of ['wg1', 'wg2', 'wg3', 'wg4']) { as(a.id); await doUpload(a.token, g, [team]); }
    // wg4 is CO-RECORDED: b also records + shares it (two rows, same gameId)
    as(b.id); await doUpload(b.token, 'wg4', [team]);
    // deterministic recency: wg1 oldest … wg4 newest (both wg4 rows get the newest stamp)
    const baseT = Date.parse('2026-02-01T00:00:00Z');
    let i = 0;
    for (const g of ['wg1', 'wg2', 'wg3', 'wg4']) {
      await getDb().update(replays).set({ createdAt: new Date(baseT + (i++) * 3_600_000) }).where(eq(replays.gameId, g));
    }
    // window to TWO games
    process.env.KB_TEAM_REPLAYS_MAX_GAMES = '2';
    as(a.id);
    const data = (await (await teamReplays(new Request('http://t'), teamParams(team))).json()).data as any[];
    delete process.env.KB_TEAM_REPLAYS_MAX_GAMES;

    // The two NEWEST games, each as ONE card. A row-based cap of 2 would have
    // returned only wg4 (its two co-recorder rows fill both row slots) — proving
    // the window now counts games, so an older game (wg3) survives.
    expect(data.map((r) => r.gameId)).toEqual(['wg4', 'wg3']);
  });
});
