import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as upload } from '@/app/api/replays/route';
import { GET as perspective } from '@/app/api/replays/[slug]/perspective/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, extensionTokens, replayAltPayload } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B112: double-sided replays. The 2nd teammate's recording is RETAINED as the
// alt perspective only when both recorders share a team, and is served only to
// authorized team members.

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
    installToken: token, payload: payload(gameId, opts), ...(opts.share ? { shareTeamSlugs: opts.share } : {}),
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
const altRow = async (slug: string) =>
  (await getDb().select().from(replayAltPayload).where(eq(replayAltPayload.replaySlug, slug)))[0];

const getPerspective = (slug: string, viewerId: string | null) => {
  as(viewerId);
  return perspective(new Request('http://t/api/replays/' + slug + '/perspective'), { params: Promise.resolve({ slug }) });
};

beforeEach(() => vi.mocked(auth).mockReset());

describe('B112 alt-perspective storage gating', () => {
  it('stores the alt when two teammates both record (shared team)', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id); const { slug } = await (await doUpload(a.token, 'g-store', { share: [team] })).json();
    as(b.id); const res = await (await doUpload(b.token, 'g-store', { localPlayerId: 'p2', actionCount: 12 })).json();
    expect(res.altStored).toBe(true);
    const row = await altRow(slug);
    expect(row).toMatchObject({ altUserId: b.id, altOwnerPlayerId: 'p2', altActionCount: 12 });
    expect(typeof row.payload).toBe('string');
  });

  it('does NOT store the alt when the recorders share no team', async () => {
    const a = await seedUser();
    const b = await seedUser(); // not on any shared team
    const team = await seedTeam(a.id, [a.id]);
    as(a.id); const { slug } = await (await doUpload(a.token, 'g-noteam', { share: [team] })).json();
    as(b.id); const res = await (await doUpload(b.token, 'g-noteam')).json();
    expect(res.deduped).toBe(true);
    expect(res.altStored).toBe(false);
    expect(await altRow(slug)).toBeUndefined();
  });

  it('does NOT store the alt for an anonymous 2nd uploader', async () => {
    const a = await seedUser();
    const team = await seedTeam(a.id, [a.id]);
    as(a.id); const { slug } = await (await doUpload(a.token, 'g-anon', { share: [team] })).json();
    // 2nd uploader: no session, unlinked token → resolves to no account.
    as(null); const res = await (await doUpload(`kbx_${randomUUID()}`, 'g-anon')).json();
    expect(res.altStored).toBe(false);
    expect(await altRow(slug)).toBeUndefined();
  });

  it('stale-guards the alt: a lower actionCount snapshot does not overwrite', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id); const { slug } = await (await doUpload(a.token, 'g-stale', { share: [team] })).json();
    as(b.id);
    await doUpload(b.token, 'g-stale', { actionCount: 50 });
    expect((await altRow(slug)).altActionCount).toBe(50);
    await doUpload(b.token, 'g-stale', { actionCount: 30 }); // stale → ignored
    expect((await altRow(slug)).altActionCount).toBe(50);
    await doUpload(b.token, 'g-stale', { actionCount: 60 }); // newer → wins
    expect((await altRow(slug)).altActionCount).toBe(60);
  });
});

describe('B112 perspective endpoint authorization', () => {
  // Two teammates record + share with the team; a third teammate views.
  async function setupShared() {
    const a = await seedUser();
    const b = await seedUser();
    const team = await seedTeam(a.id, [a.id, b.id]);
    as(a.id); const { slug } = await (await doUpload(a.token, 'g-' + randomUUID().slice(0, 5), { share: [team] })).json();
    as(b.id); await doUpload(b.token, await gameIdOf(slug), { localPlayerId: 'p2' });
    return { a, b, team, slug };
  }
  // helper: read the gameId we uploaded under (it's stored on the replay row)
  async function gameIdOf(slug: string) {
    const { replays } = await import('@/lib/schema');
    const [r] = await getDb().select().from(replays).where(eq(replays.slug, slug));
    return r.gameId;
  }

  it('serves the alt to an eligible team member (both recorders on the shared team)', async () => {
    const { a, slug } = await setupShared();
    const res = await getPerspective(slug, a.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.altOwnerPlayerId).toBe('p2');
    expect(typeof body.payload).toBe('string');
  });

  it('401s an anonymous viewer', async () => {
    const { slug } = await setupShared();
    const res = await getPerspective(slug, null);
    expect(res.status).toBe(401);
  });

  it('403s a viewer who is not on a team the replay is shared with', async () => {
    const { slug } = await setupShared();
    const outsider = await seedUser();
    await seedTeam(outsider.id, [outsider.id]); // their own unrelated team
    const res = await getPerspective(slug, outsider.id);
    expect(res.status).toBe(403);
  });

  it('403s once a recorder has left the shared team', async () => {
    const { a, b, team, slug } = await setupShared();
    await getDb().delete(teamMembers).where(eq(teamMembers.userId, b.id)); // b (alt recorder) leaves
    const res = await getPerspective(slug, a.id);
    expect(res.status).toBe(403);
  });

  it('403s when no alt was stored', async () => {
    const a = await seedUser();
    const team = await seedTeam(a.id, [a.id]);
    as(a.id); const { slug } = await (await doUpload(a.token, 'g-noalt', { share: [team] })).json();
    const res = await getPerspective(slug, a.id);
    expect(res.status).toBe(403);
  });

  it('refuses a sample replay even for an eligible viewer', async () => {
    const { a, slug } = await setupShared();
    process.env.KARABUDDY_SAMPLE_REPLAY_SLUGS = slug;
    try {
      const res = await getPerspective(slug, a.id);
      expect(res.status).toBe(403);
    } finally {
      delete process.env.KARABUDDY_SAMPLE_REPLAY_SLUGS;
    }
  });
});
