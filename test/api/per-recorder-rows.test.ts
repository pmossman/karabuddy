import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as upload } from '@/app/api/replays/route';
import { GET as teamReplays } from '@/app/api/teams/[slug]/replays/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, extensionTokens, replays, replayAltPayload } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B166: per-recorder replay rows. Two teammates who both record one karabast
// game each keep their OWN independent row (their POV) — exactly like opponents
// (B158). "Double-sided" is no longer a fold of the 2nd recording into the 1st
// recorder's row (replay_alt_payload); it's a RUNTIME composition of the two
// sibling rows, built when their owners currently share a team. So a recorder
// who later leaves the team still has their own one-sided row in My Replays.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

function payload(gameId: string, opts: { localPlayerId?: string; actionCount?: number } = {}) {
  return JSON.stringify({
    version: 2, actionCount: opts.actionCount ?? 10, durationMs: 1000, localPlayerId: opts.localPlayerId ?? 'p1',
    events: [{ event: 'gamestate', args: [{ full: { id: gameId, players: {
      p1: { user: { username: 'whatever' }, leader: { name: 'L', setId: { set: 'SOR', number: 1 } }, base: { name: 'B', setId: { set: 'SOR', number: 2 } } },
      p2: { user: { username: 'opp' } },
    } } }] }],
    tags: [],
  });
}
const doUpload = (token: string, gameId: string, opts: { share?: string[]; localPlayerId?: string; actionCount?: number } = {}) =>
  upload(new Request('http://t/api/replays', { method: 'POST', body: JSON.stringify({
    installToken: token, payload: payload(gameId, opts),
    ...(opts.share ? { shareTeamSlugs: opts.share } : {}),
  }) }));

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

beforeEach(() => vi.mocked(auth).mockReset());

describe('B166 per-recorder rows: teammates each keep their own row', () => {
  it('two teammates recording one game produce two independent rows (no fold, no alt)', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);

    as(a.id); const first = await (await doUpload(a.token, 'g-pair', { share: [team], localPlayerId: 'p1' })).json();
    as(b.id); const second = await (await doUpload(b.token, 'g-pair', { localPlayerId: 'p2', actionCount: 12 })).json();

    // The 2nd recorder gets their OWN row, not a dedupe onto the 1st.
    expect(second.slug).not.toBe(first.slug);
    expect(second.deduped).toBeUndefined();

    // Two rows for the one gameId, one per recorder, each self-owned.
    const rows = await getDb().select().from(replays).where(eq(replays.gameId, 'g-pair'));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual([a.id, b.id].sort());
    expect(rows.find((r) => r.userId === a.id)!.ownerPlayerId).toBe('p1');
    expect(rows.find((r) => r.userId === b.id)!.ownerPlayerId).toBe('p2');

    // No alt payload is folded onto the 1st recorder's row anymore.
    const alt = await getDb().select().from(replayAltPayload).where(eq(replayAltPayload.replaySlug, first.slug));
    expect(alt).toHaveLength(0);
  });

  it("each recorder's own row still upserts their later snapshots (one row per recorder)", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);

    as(a.id); await doUpload(a.token, 'g-snap', { share: [team], actionCount: 10 });
    as(b.id); await doUpload(b.token, 'g-snap', { localPlayerId: 'p2', actionCount: 10 });
    // later snapshots from each recorder update their OWN row, don't multiply rows
    as(a.id); await doUpload(a.token, 'g-snap', { actionCount: 40 });
    as(b.id); await doUpload(b.token, 'g-snap', { localPlayerId: 'p2', actionCount: 50 });

    const rows = await getDb().select().from(replays).where(eq(replays.gameId, 'g-snap'));
    expect(rows).toHaveLength(2);
  });
});

describe('B166 Phase 3: team grid collapses co-recordings by gameId', () => {
  const listTeam = async (team: string) =>
    (await (await teamReplays(new Request('http://t'), { params: Promise.resolve({ slug: team }) })).json()).data as any[];

  it('two teammates who both share one game show as ONE card (not two mirrored)', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id); await doUpload(a.token, 'g-collapse', { share: [team], localPlayerId: 'p1' });
    as(b.id); await doUpload(b.token, 'g-collapse', { share: [team], localPlayerId: 'p2' });

    as(a.id);
    const cards = (await listTeam(team)).filter((r) => r.gameId === 'g-collapse');
    expect(cards).toHaveLength(1);            // collapsed — was the mirror bug
    expect(cards[0].internal).toBe(true);
    expect(cards[0].doubleSided).toBe(true);
  });

  it('distinct games are NOT collapsed', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id); await doUpload(a.token, 'g-one', { share: [team] });
    as(b.id); await doUpload(b.token, 'g-one', { share: [team] });
    as(a.id); await doUpload(a.token, 'g-two', { share: [team] });
    as(b.id); await doUpload(b.token, 'g-two', { share: [team] });

    as(a.id);
    const data = await listTeam(team);
    expect(data.filter((r) => r.gameId === 'g-one')).toHaveLength(1);
    expect(data.filter((r) => r.gameId === 'g-two')).toHaveLength(1);
  });
});
