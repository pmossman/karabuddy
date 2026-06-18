import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as upload } from '@/app/api/replays/route';
import { GET as perspective } from '@/app/api/replays/[slug]/perspective/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, extensionTokens, replays } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';

// B166: double-sided replays are a RUNTIME composition of two independent
// sibling rows (same gameId, different recorders) — not a stored alt payload.
// The /perspective endpoint serves the SIBLING row's recording, gated by
// entitledSibling: the two recorders may compose while they CURRENTLY share a
// team; a third-party teammate may compose only on a shared team containing both
// recorders. Leaving the team revokes the composed view immediately, while each
// recorder's own one-sided row is untouched.

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

const getPerspective = (slug: string, viewerId: string | null) => {
  as(viewerId);
  return perspective(new Request('http://t/api/replays/' + slug + '/perspective'), { params: Promise.resolve({ slug }) });
};

beforeEach(() => vi.mocked(auth).mockReset());

describe('B166 double-sided as sibling composition', () => {
  // Two teammates record one game; A shares with the team. Returns both rows'
  // slugs (one per recorder) — they are SEPARATE rows now.
  async function setupShared() {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    const gameId = 'g-' + randomUUID().slice(0, 6);
    as(a.id); const aRes = await (await doUpload(a.token, gameId, { share: [team], localPlayerId: 'p1' })).json();
    as(b.id); const bRes = await (await doUpload(b.token, gameId, { localPlayerId: 'p2', actionCount: 12 })).json();
    return { a, b, team, gameId, aSlug: aRes.slug, bSlug: bRes.slug };
  }

  it('two teammates produce two independent rows (no fold)', async () => {
    const { aSlug, bSlug, gameId } = await setupShared();
    expect(aSlug).not.toBe(bSlug);
    const rows = await getDb().select().from(replays).where(eq(replays.gameId, gameId));
    expect(rows).toHaveLength(2);
  });

  it('serves the sibling POV to an eligible third-party team member', async () => {
    const { a, b, team, aSlug } = await setupShared();
    // a third teammate (not a recorder) on the shared team
    const c = await seedUser();
    await getDb().insert(teamMembers).values({ teamSlug: team, userId: c.id, role: 'member' });
    const res = await getPerspective(aSlug, c.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.altOwnerPlayerId).toBe('p2'); // the sibling (b) recorded as p2
    expect(typeof body.payload).toBe('string');
    void a; void b;
  });

  it('401s an anonymous viewer', async () => {
    const { aSlug } = await setupShared();
    expect((await getPerspective(aSlug, null)).status).toBe(401);
  });

  it('403s a viewer with no relationship to either recorder', async () => {
    const { aSlug } = await setupShared();
    const outsider = await seedUser();
    await seedTeam(outsider.id, [outsider.id]);
    expect((await getPerspective(aSlug, outsider.id)).status).toBe(403);
  });

  it('403s a third-party teammate once a recorder leaves the shared team', async () => {
    const { b, team, aSlug } = await setupShared();
    const c = await seedUser();
    await getDb().insert(teamMembers).values({ teamSlug: team, userId: c.id, role: 'member' });
    expect((await getPerspective(aSlug, c.id)).status).toBe(200);
    await getDb().delete(teamMembers).where(eq(teamMembers.userId, b.id)); // sibling recorder leaves
    expect((await getPerspective(aSlug, c.id)).status).toBe(403);
  });

  it('403s when the game has only one recorder (no sibling)', async () => {
    const a = await seedUser();
    const team = await seedTeam(a.id, [a.id]);
    as(a.id); const { slug } = await (await doUpload(a.token, 'g-solo', { share: [team] })).json();
    expect((await getPerspective(slug, a.id)).status).toBe(403);
  });

  // The two recorders compose their own game even when it was never shared with
  // a team — being in the match is implicit consent — as long as they currently
  // share a team.
  it('serves to the base recorder even when never shared (recorders share a team)', async () => {
    const a = await seedUser();
    const b = await seedUser();
    await seedTeam(a.id, [a.id, b.id]);
    as(a.id); const aRes = await (await doUpload(a.token, 'g-unshared', { localPlayerId: 'p1' })).json();
    as(b.id); await doUpload(b.token, 'g-unshared', { localPlayerId: 'p2' });
    const res = await getPerspective(aRes.slug, a.id);
    expect(res.status).toBe(200);
    expect((await res.json()).altOwnerPlayerId).toBe('p2');
  });

  it('serves to the sibling recorder even when never shared (recorders share a team)', async () => {
    const a = await seedUser();
    const b = await seedUser();
    await seedTeam(a.id, [a.id, b.id]);
    as(a.id); await doUpload(a.token, 'g-unshared2', { localPlayerId: 'p1' });
    as(b.id); const bRes = await (await doUpload(b.token, 'g-unshared2', { localPlayerId: 'p2' })).json();
    // b views THEIR OWN row → the composed sibling is a's recording (p1)
    const res = await getPerspective(bRes.slug, b.id);
    expect(res.status).toBe(200);
    expect((await res.json()).altOwnerPlayerId).toBe('p1');
  });

  // B166 behavior change: a RECORDER who leaves the team loses the composed
  // double-sided view (they keep their own one-sided row — see per-recorder-rows).
  it('403s a recorder once they leave the shared team', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id); const aRes = await (await doUpload(a.token, 'g-leave', { localPlayerId: 'p1' })).json();
    as(b.id); await doUpload(b.token, 'g-leave', { localPlayerId: 'p2' });
    expect((await getPerspective(aRes.slug, a.id)).status).toBe(200);
    await getDb().delete(teamMembers).where(and(eq(teamMembers.userId, b.id), eq(teamMembers.teamSlug, team)));
    expect((await getPerspective(aRes.slug, a.id)).status).toBe(403); // no shared team → no compose
  });

  it('refuses a sample replay even for an eligible viewer', async () => {
    const { a, aSlug } = await setupShared();
    process.env.KARABUDDY_SAMPLE_REPLAY_SLUGS = aSlug;
    try {
      expect((await getPerspective(aSlug, a.id)).status).toBe(403);
    } finally {
      delete process.env.KARABUDDY_SAMPLE_REPLAY_SLUGS;
    }
  });
});
