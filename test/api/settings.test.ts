import { describe, expect, it, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET as getSettings, PATCH as patchSettings } from '@/app/api/me/settings/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, extensionTokens } from '@/lib/schema';

// API integration test for per-user extension settings (B75).

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const mockedAuth = vi.mocked(auth);

async function seedUser(id = randomUUID()) {
  await getDb().insert(users).values({ id, name: 'U', email: `${id}@example.com` });
  return id;
}
async function seedTeam(userId: string, slug = randomUUID().slice(0, 6)) {
  const db = getDb();
  await db.insert(teams).values({ slug, name: slug, createdBy: userId });
  await db.insert(teamMembers).values({ teamSlug: slug, userId, role: 'owner' });
  return slug;
}
function withSession(userId: string | null) {
  mockedAuth.mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));
}
const req = (method: string, body?: unknown, headers?: Record<string, string>) =>
  new Request('http://test/api/me/settings', {
    method,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => mockedAuth.mockReset());

describe('GET /api/me/settings', () => {
  it('401s anonymous callers', async () => {
    withSession(null);
    expect((await getSettings(req('GET'))).status).toBe(401);
  });

  it('returns defaults for a fresh user', async () => {
    const id = await seedUser();
    withSession(id);
    const body = await (await getSettings(req('GET'))).json();
    expect(body).toMatchObject({ ok: true, shareTeamSlugs: [], minUploadActions: 5 });
  });

  it('resolves via the X-Install-Token header when there is no session', async () => {
    const id = await seedUser();
    const token = `kbx_${randomUUID()}`;
    await getDb().insert(extensionTokens).values({ token, userId: id });
    withSession(null);
    const res = await getSettings(req('GET', undefined, { 'x-install-token': token }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe('PATCH /api/me/settings', () => {
  it('clamps minUploadActions into [1, 50]', async () => {
    const id = await seedUser();
    withSession(id);
    expect((await (await patchSettings(req('PATCH', { minUploadActions: 100 }))).json()).minUploadActions).toBe(50);
    expect((await (await patchSettings(req('PATCH', { minUploadActions: 0 }))).json()).minUploadActions).toBe(1);
    expect((await (await patchSettings(req('PATCH', { minUploadActions: 8 }))).json()).minUploadActions).toBe(8);
  });

  it('persists shareTeamSlugs but drops slugs the user is not a member of', async () => {
    const id = await seedUser();
    const mine = await seedTeam(id);
    withSession(id);
    const body = await (await patchSettings(req('PATCH', { shareTeamSlugs: [mine, 'not-my-team'] }))).json();
    expect(body.shareTeamSlugs).toEqual([mine]);
  });

  it('leaves unspecified fields untouched', async () => {
    const id = await seedUser();
    withSession(id);
    await patchSettings(req('PATCH', { minUploadActions: 9 }));
    const body = await (await patchSettings(req('PATCH', { shareTeamSlugs: [] }))).json();
    expect(body.minUploadActions).toBe(9); // not reset by a shareTeamSlugs-only patch
  });
});
