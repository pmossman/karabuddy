import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as upload } from '@/app/api/replays/route';
import { GET as teamReplays } from '@/app/api/teams/[slug]/replays/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, extensionTokens, replayParticipants } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B84: account-based intra-team detection. A match is "internal" when ≥2 of its
// RECORDERS (replay_participants, by karabuddy account) are teammates — no
// karabast usernames involved.

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
    as(b.id); expect((await (await doUpload(b.token, 'g-int')).json()).deduped).toBe(true); // B records same match
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
});
