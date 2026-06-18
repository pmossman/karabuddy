import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backfillSiblingRows } from '@/scripts/backfill-sibling-rows';
import { GET as perspective } from '@/app/api/replays/[slug]/perspective/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayAltPayload } from '@/lib/schema';
import { put } from '@/lib/blob';
import { and, eq } from 'drizzle-orm';

// B166 Phase 4: backfill historically FOLDED double-sided replays (canonical row
// + alt payload, no 2nd row) into independent per-recorder rows, so the 2nd
// recorder gets their own row AND the sibling-sourced /perspective keeps working.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id}@e.com` });
  return id;
}

// Seed a pre-B166 folded double-sided game: A's canonical row + B's alt payload.
async function seedFolded(opts: { altUserId: string | null } & { aId: string }) {
  const slug = 'r_' + randomUUID().slice(0, 8);
  const gameId = 'g-' + randomUUID().slice(0, 8);
  const blob = await put(`replays/${slug}.json`, JSON.stringify({ canonical: true }), { access: 'public', contentType: 'application/json', addRandomSuffix: false } as any);
  await getDb().insert(replays).values({
    slug, gameId, userId: opts.aId, ownerToken: `kbx_${randomUUID()}`,
    players: [{ id: 'p1', username: 'A' }, { id: 'p2', username: 'B' }],
    payloadBlobUrl: blob.url, ownerPlayerId: 'p1', winners: ['p1'],
    match: { lobbyId: 'lob-1', format: 'premier' }, decks: { p1: ['x'], p2: ['y'] },
  });
  await getDb().insert(replayAltPayload).values({
    replaySlug: slug, altUserId: opts.altUserId, altOwnerPlayerId: 'p2', altActionCount: 22,
    payload: JSON.stringify({ alt: true, localPlayerId: 'p2' }),
  });
  return { slug, gameId };
}

beforeEach(() => vi.mocked(auth).mockReset());

describe('B166 backfill: fold → independent sibling rows', () => {
  it('materializes a sibling row owned by the alt recorder, copying game metadata', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const { slug, gameId } = await seedFolded({ aId: a, altUserId: b });

    const res = await backfillSiblingRows({ apply: true });
    expect(res.created).toBeGreaterThanOrEqual(1);

    const [sibling] = await getDb().select().from(replays).where(and(eq(replays.gameId, gameId), eq(replays.userId, b)));
    expect(sibling).toBeTruthy();
    expect(sibling.slug).not.toBe(slug);
    expect(sibling.ownerPlayerId).toBe('p2');         // the alt POV
    expect(sibling.actionCount).toBe(22);             // from the alt payload
    expect(sibling.winners).toEqual(['p1']);          // copied game outcome
    expect((sibling.match as any).lobbyId).toBe('lob-1'); // copied game meta
  });

  it('is idempotent — a second run creates nothing new', async () => {
    const a = await seedUser();
    const b = await seedUser();
    await seedFolded({ aId: a, altUserId: b });
    await backfillSiblingRows({ apply: true });
    const second = await backfillSiblingRows({ apply: true });
    expect(second.created).toBe(0);
  });

  it('dry run creates no rows', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const { gameId } = await seedFolded({ aId: a, altUserId: b });
    await backfillSiblingRows({ apply: false });
    const rows = await getDb().select().from(replays).where(eq(replays.gameId, gameId));
    expect(rows).toHaveLength(1); // only the canonical row
  });

  it('skips an orphaned alt (recorder account deleted → altUserId null)', async () => {
    const a = await seedUser();
    const { gameId } = await seedFolded({ aId: a, altUserId: null });
    const res = await backfillSiblingRows({ apply: true });
    expect(res.orphaned).toBeGreaterThanOrEqual(1);
    const rows = await getDb().select().from(replays).where(eq(replays.gameId, gameId));
    expect(rows).toHaveLength(1);
  });

  it('after backfill, /perspective serves the 2nd POV for the historical game', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const team = randomUUID().slice(0, 6);
    await getDb().insert(teams).values({ slug: team, name: team, createdBy: a });
    await getDb().insert(teamMembers).values([
      { teamSlug: team, userId: a, role: 'owner' },
      { teamSlug: team, userId: b, role: 'member' },
    ]);
    const { slug } = await seedFolded({ aId: a, altUserId: b });

    // Before backfill: no sibling row → not available.
    as(a);
    const before = await perspective(new Request('http://t'), { params: Promise.resolve({ slug }) });
    expect(before.status).toBe(403);

    await backfillSiblingRows({ apply: true });

    // After backfill: A (a recorder, shares a team with B) can compose the sibling.
    as(a);
    const after = await perspective(new Request('http://t'), { params: Promise.resolve({ slug }) });
    expect(after.status).toBe(200);
    expect((await after.json()).altOwnerPlayerId).toBe('p2');
  });
});
