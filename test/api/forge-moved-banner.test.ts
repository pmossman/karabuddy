import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { getDb } from '@/lib/db';
import { teamMembers, teams, users } from '@/lib/schema';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

class Redirected extends Error {
  constructor(public to: string) {
    super('redirect');
  }
}
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
}));

const { auth } = await import('@/auth');
const TeamPage = (await import('@/app/(app)/teams/[slug]/page')).default;
const { ForgeMovedBanner } = await import('@/app/(app)/teams/[slug]/ForgeMovedBanner');

const as = (userId: string | null) =>
  vi.mocked(auth).mockResolvedValue(userId ? ({ user: { id: userId, email: 'x@e.com' } } as any) : (null as any));

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id.slice(0, 8)}@e.com` });
  return id;
}

async function seedTeam(owner: string, members: string[], moved: boolean) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: 'Tuesday Night Draft', createdBy: owner });
  await getDb()
    .insert(teamMembers)
    .values([{ teamSlug: slug, userId: owner, role: 'owner' }, ...members.map((userId) => ({ teamSlug: slug, userId, role: 'member' }))]);
  if (moved) {
    await getDb()
      .update(teams)
      .set({ forgeTeamId: 'ck1', forgeTeamUrl: 'https://forge.test/teams/ck1', forgeMovedAt: new Date('2026-10-04T18:00:00Z') })
      .where(eq(teams.slug, slug));
  }
  return slug;
}

function find(node: ReactNode, type: unknown): ReactElement<any> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  return find((node.props as { children?: ReactNode }).children, type);
}

const banner = async (slug: string, tab?: string) => find(await TeamPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({ tab }) }), ForgeMovedBanner);

beforeEach(() => {
  vi.mocked(auth).mockReset();
  jar.clear();
  vi.stubEnv('TEAM_MIGRATION_SECRET', 'shared-secret');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the moved-to-SWU Forge banner on team pages', () => {
  it('shows every member the link and the straggler guidance', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam(owner, [member], true);
    as(member);
    const el = await banner(slug);
    expect(el?.props).toMatchObject({ teamName: 'Tuesday Night Draft', url: 'https://forge.test/teams/ck1', movedOn: 'Oct 4, 2026', owner: false });
    expect(await banner(slug, 'replays')).not.toBeNull();
  });

  it('shows owners the move date and the hub link for newcomers', async () => {
    const owner = await seedUser();
    const slug = await seedTeam(owner, [], true);
    as(owner);
    expect((await banner(slug))?.props).toMatchObject({ owner: true, inviteHref: `/swu-forge?team=${slug}` });

    vi.stubEnv('TEAM_MIGRATION_SECRET', '');
    expect((await banner(slug))?.props).toMatchObject({ owner: true, inviteHref: null });
  });

  it('is absent for a team that has not moved', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam(owner, [member], false);
    as(member);
    expect(await banner(slug)).toBeNull();
  });

  it('is absent for someone who is not on the team', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const slug = await seedTeam(owner, [], true);
    as(stranger);
    expect(await banner(slug)).toBeNull();
  });

  it('sends signed-out visitors to sign in as before', async () => {
    const owner = await seedUser();
    const slug = await seedTeam(owner, [], true);
    as(null);
    await expect(banner(slug)).rejects.toMatchObject({ to: `/signin?callbackUrl=/teams/${slug}` });
  });

  it('stays hidden for the rest of the session once hidden, and off the openings table', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam(owner, [member], true);
    as(member);
    expect(await banner(slug, 'openings')).toBeNull();
    jar.set('kb_forge_moved_hidden', '1');
    expect(await banner(slug)).toBeNull();
  });
});
