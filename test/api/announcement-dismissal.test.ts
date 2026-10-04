import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST } from '@/app/api/me/announcement-dismissal/route';
import { getDismissedAnnouncementVersion } from '@/lib/announcements';
import { getDb } from '@/lib/db';
import { users } from '@/lib/schema';
import { FORGE_ANNOUNCEMENT_VERSION } from '@/app/_components/forgeAnnouncement/constants';
import { isDismissed } from '@/app/_components/forgeAnnouncement/rules';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (userId: string | null) =>
  vi.mocked(auth).mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));

async function seedUser(dismissed: number | null = null) {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: 'U', email: `${id}@e.com`, announcementDismissedVersion: dismissed });
  return id;
}
const post = (body: unknown) =>
  POST(new Request('http://t/api/me/announcement-dismissal', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => vi.mocked(auth).mockReset());

describe('POST /api/me/announcement-dismissal', () => {
  it('records the dismissal on the signed-in account only', async () => {
    const me = await seedUser();
    const other = await seedUser();
    as(me);

    const res = await post({ version: FORGE_ANNOUNCEMENT_VERSION });
    expect(res.status).toBe(200);
    expect(await getDismissedAnnouncementVersion(me)).toBe(FORGE_ANNOUNCEMENT_VERSION);
    expect(await getDismissedAnnouncementVersion(other)).toBeNull();
  });

  it('is idempotent', async () => {
    const me = await seedUser();
    as(me);

    expect((await post({ version: FORGE_ANNOUNCEMENT_VERSION })).status).toBe(200);
    expect((await post({ version: FORGE_ANNOUNCEMENT_VERSION })).status).toBe(200);
    expect(await getDismissedAnnouncementVersion(me)).toBe(FORGE_ANNOUNCEMENT_VERSION);
  });

  it('never lowers a newer dismissal', async () => {
    const me = await seedUser(FORGE_ANNOUNCEMENT_VERSION + 1);
    as(me);

    expect((await post({ version: FORGE_ANNOUNCEMENT_VERSION })).status).toBe(200);
    expect(await getDismissedAnnouncementVersion(me)).toBe(FORGE_ANNOUNCEMENT_VERSION + 1);
  });

  it('signed out → 401, nothing written', async () => {
    const me = await seedUser();
    as(null);

    expect((await post({ version: FORGE_ANNOUNCEMENT_VERSION })).status).toBe(401);
    expect(await getDismissedAnnouncementVersion(me)).toBeNull();
  });

  it('rejects versions that do not exist yet, or are not versions', async () => {
    const me = await seedUser();
    as(me);

    for (const version of [FORGE_ANNOUNCEMENT_VERSION + 1, 0, -1, 1.5, '1', null]) {
      expect((await post({ version })).status).toBe(400);
    }
    expect((await post(undefined)).status).toBe(400);
    expect(await getDismissedAnnouncementVersion(me)).toBeNull();
  });

  it('a stale dismissal still shows the current letter; the current one hides it', async () => {
    const stale = await seedUser(FORGE_ANNOUNCEMENT_VERSION - 1);
    expect(isDismissed(await getDismissedAnnouncementVersion(stale))).toBe(false);

    as(stale);
    await post({ version: FORGE_ANNOUNCEMENT_VERSION });
    expect(isDismissed(await getDismissedAnnouncementVersion(stale))).toBe(true);
    expect(isDismissed(await getDismissedAnnouncementVersion(stale), FORGE_ANNOUNCEMENT_VERSION + 1)).toBe(false);
  });
});
