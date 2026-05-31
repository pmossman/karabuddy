import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET as getGlobal, PATCH as patchGlobal } from '@/app/api/me/notifications/route';
import { GET as getTeamPrefs, PATCH as patchTeamPrefs } from '@/app/api/teams/[slug]/members/me/prefs/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers } from '@/lib/schema';

// B81: notification preference endpoints — global kill switch + per-team prefs.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: 'U', email: `${id}@e.com` });
  return id;
}
async function seedTeam(owner: string, members: string[] = [owner]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: owner });
  await getDb().insert(teamMembers).values(members.map((userId) => ({ teamSlug: slug, userId, role: 'member' })));
  return slug;
}
const body = (method: string, b?: unknown) => new Request('http://t', { method, body: b === undefined ? undefined : JSON.stringify(b) });
const teamParams = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => vi.mocked(auth).mockReset());

describe('GET/PATCH /api/me/notifications (global kill switch)', () => {
  it('401s anon', async () => { as(null); expect((await getGlobal()).status).toBe(401); });
  it('defaults to enabled (not disabled), and PATCH flips it', async () => {
    const id = await seedUser();
    as(id);
    expect((await (await getGlobal()).json()).notificationsDisabled).toBe(false);
    await patchGlobal(body('PATCH', { notificationsDisabled: true }));
    expect((await (await getGlobal()).json()).notificationsDisabled).toBe(true);
  });
  it('400s a non-boolean', async () => {
    const id = await seedUser(); as(id);
    expect((await patchGlobal(body('PATCH', { notificationsDisabled: 'yes' }))).status).toBe(400);
  });
});

describe('GET/PATCH /api/teams/:slug/members/me/prefs', () => {
  it('403s a non-member', async () => {
    const owner = await seedUser();
    const slug = await seedTeam(owner);
    as(await seedUser());
    expect((await getTeamPrefs(body('GET'), teamParams(slug))).status).toBe(403);
  });
  it('defaults both prefs ON for a member', async () => {
    const id = await seedUser();
    const slug = await seedTeam(id, [id]);
    as(id);
    expect(await (await getTeamPrefs(body('GET'), teamParams(slug))).json()).toMatchObject({ ok: true, dmOnDirectMention: true, dmOnTeamMention: true });
  });
  it('PATCH persists a single pref and leaves the other unchanged', async () => {
    const id = await seedUser();
    const slug = await seedTeam(id, [id]);
    as(id);
    await patchTeamPrefs(body('PATCH', { dmOnTeamMention: false }), teamParams(slug));
    const got = await (await getTeamPrefs(body('GET'), teamParams(slug))).json();
    expect(got.dmOnTeamMention).toBe(false);
    expect(got.dmOnDirectMention).toBe(true); // untouched
  });
});
