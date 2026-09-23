import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { teamMembers, teams, users } from '@/lib/schema';

// The /teams/<slug>/move PREVIEW SCREEN's own gate: the shared secret, then
// owners-only. It has to hold here and not just on the API route, because
// typing the URL is exactly how someone finds a feature whose settings card is
// merely hidden — and hiding the card is all the localStorage flag does.
// Anyone who fails either check gets `notFound()`, the same nothing as while
// the feature is dark.
//
// The preview component is stubbed: this test is about who reaches the screen,
// not what the screen draws (that is MoveTeamPreview's own business, and it
// draws nothing until Forge answers).

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/app/(app)/teams/[slug]/move/MoveTeamPreview', () => ({
  MoveTeamPreview: () => null,
}));

// `notFound()` and `redirect()` throw in Next; sentinels let us assert which.
class NotFound extends Error {}
class Redirected extends Error {
  constructor(public to: string) {
    super('redirect');
  }
}
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFound();
  },
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

const { auth } = await import('@/auth');
const MoveTeamPage = (await import('@/app/(app)/teams/[slug]/move/page')).default;

// ⛔ The email gates nothing; it is only what the payload's `initiator` carries.
const as = (userId: string | null, email: string | null = 'owner@e.com') =>
  vi.mocked(auth).mockResolvedValue(userId ? ({ user: { id: userId, email } } as any) : (null as any));

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id.slice(0, 8)}@e.com` });
  return id;
}

async function seedTeam(owner: string, members: { id: string; role?: string }[] = []) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: 'Rebel Cell', createdBy: owner });
  await getDb()
    .insert(teamMembers)
    .values([
      { teamSlug: slug, userId: owner, role: 'owner' },
      ...members.map((m) => ({ teamSlug: slug, userId: m.id, role: m.role ?? 'member' })),
    ]);
  return slug;
}

const open = (slug: string) => MoveTeamPage({ params: Promise.resolve({ slug }) });

const opening = async (slug: string) => {
  try {
    await open(slug);
    return 'rendered' as const;
  } catch (e) {
    if (e instanceof NotFound) return 'not_found' as const;
    if (e instanceof Redirected) return 'redirected' as const;
    throw e;
  }
};

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.stubEnv('SWU_FORGE_ORIGIN', 'https://forge.test');
  vi.stubEnv('TEAM_MIGRATION_SECRET', 'shared-secret');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the move preview screen', () => {
  // ⭐ No per-user allowlist. The settings card is hidden behind a localStorage
  // flag, which hides only the entry point; this page's boundary is owners-only
  // plus the shared secret. An owner who types the URL can preview their OWN
  // team's move — a deliberate, accepted trade.
  it('renders for any owner once the secret is set', async () => {
    const owner = await seedUser();
    const slug = await seedTeam(owner);
    as(owner);
    expect(await opening(slug)).toBe('rendered');
  });

  it('renders for an owner whatever their email, and with none at all', async () => {
    const owner = await seedUser();
    const slug = await seedTeam(owner);
    as(owner, 'someone-else@e.com');
    expect(await opening(slug)).toBe('rendered');
    as(owner, null);
    expect(await opening(slug)).toBe('rendered');
  });

  it('404s a plain member — owners only', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam(owner, [{ id: member }]);
    as(member);
    expect(await opening(slug)).toBe('not_found');
  });

  it('404s an owner while the feature is dark', async () => {
    vi.stubEnv('TEAM_MIGRATION_SECRET', '');
    const owner = await seedUser();
    const slug = await seedTeam(owner);
    as(owner);
    expect(await opening(slug)).toBe('not_found');
  });

  it('sends a signed-out visitor to sign-in, as before', async () => {
    const owner = await seedUser();
    const slug = await seedTeam(owner);
    as(null);
    expect(await opening(slug)).toBe('redirected');
  });
});
