import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET as decklistsGet } from '@/app/api/teams/[slug]/sideboard-guides/decklists/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares, cards } from '@/lib/schema';

// B232: baseline decklists for authoring a guide from a real list — recent shared
// replays of an archetype, full main + sideboard, viewer's own first, base-filtered.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

async function seedUser(name: string) {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name, email: `${id}@e.com` });
  return id;
}
async function seedTeam(owner: string, members: string[]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: owner });
  await getDb().insert(teamMembers).values(members.map((u) => ({ teamSlug: slug, userId: u, role: u === owner ? 'owner' : 'member' })));
  return slug;
}
// A shared replay whose recorder ran Cad Bane + vanilla command base (SOR_020),
// with an explicit deck + sideboard and a controllable recency.
async function seedReplay(team: string, owner: string, opts: { deck: [string, number][]; side: [string, number][]; when: string; opp?: string }) {
  const slug = randomUUID().slice(0, 8);
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), ownerToken: `kbx_${randomUUID()}`, userId: owner, ownerPlayerId: 'P',
    createdAt: new Date(opts.when),
    players: [
      { id: 'P', leader: { name: 'Cad Bane', set: 'SOR', number: 1 }, base: { name: 'Command Base', set: 'SOR', number: 20 } },
      { id: 'Q', leader: { name: opts.opp ?? 'Ahsoka', set: 'SHD', number: 5 }, base: { name: 'X', set: 'SOR', number: 21 } },
    ],
    payloadBlobUrl: 'blob://x', match: { gameFormat: 'premier' },
    decks: { P: { username: 'r', leader: null, base: null, deck: opts.deck.map(([id, count]) => ({ id, count })), sideboard: opts.side.map(([id, count]) => ({ id, count })) } },
  });
  await getDb().insert(replayTeamShares).values({ replaySlug: slug, teamSlug: team, sharedBy: owner });
  return slug;
}
const p = (slug: string) => ({ params: Promise.resolve({ slug }) });
const call = (slug: string, q: Record<string, string>) => decklistsGet(new Request(`http://t?${new URLSearchParams(q)}`), p(slug));

beforeEach(() => vi.mocked(auth).mockReset());

describe('sideboard-guides decklists', () => {
  it('returns recent lists of the archetype (main + sideboard), viewer own first, base-filtered', async () => {
    const a = await seedUser('Ann'); const b = await seedUser('Bo');
    const team = await seedTeam(a, [a, b]);
    // SOR_020 = vanilla command base → identity key asp:command.
    await getDb().insert(cards).values({ cardId: 'SOR_020', name: 'Command Base', type: 'base', set: 'SOR', number: 20, aspects: ['command'], hasAbility: false, baseAbilityHash: null, source: 'seed' }).onConflictDoNothing();

    const bLater = await seedReplay(team, b, { deck: [['ASH_010', 3], ['ASH_020', 2]], side: [['ASH_090', 2]], when: '2026-06-03T00:00:00Z', opp: 'Boba' });
    const aOld = await seedReplay(team, a, { deck: [['ASH_010', 3]], side: [['ASH_099', 1]], when: '2026-06-01T00:00:00Z' });

    as(a);
    const j = await (await call(team, { ownLeader: 'Cad Bane', ownBase: 'asp:command' })).json();
    expect(j.ok).toBe(true);
    const dl = j.data.decklists;
    expect(dl).toHaveLength(2);
    // Ann's own list sorts first even though Bo's is more recent.
    expect(dl[0].replaySlug).toBe(aOld);
    expect(dl[0].isMine).toBe(true);
    expect(dl[1].isMine).toBe(false);
    expect(dl[1].recorderName).toBe('Bo');
    expect(dl[1].oppLeaderName).toBe('Boba');
    // Full main + sideboard with copy counts.
    const bo = dl.find((d: any) => d.replaySlug === bLater);
    expect(bo.main.map((c: any) => [c.cardId, c.count])).toEqual([['ASH_010', 3], ['ASH_020', 2]]);
    expect(bo.sideboard).toEqual([{ cardId: 'ASH_090', count: 2, name: null, subtitle: null, set: null, number: null, cost: null, type: null }]);

    // A base that no recorded list runs → nothing.
    const none = await (await call(team, { ownLeader: 'Cad Bane', ownBase: 'asp:aggression' })).json();
    expect(none.data.decklists).toHaveLength(0);

    // Leader-only (no base filter) still returns both.
    expect((await (await call(team, { ownLeader: 'Cad Bane' })).json()).data.decklists).toHaveLength(2);
  });

  it('member-only; ownLeader required', async () => {
    const a = await seedUser('Ann');
    const team = await seedTeam(a, [a]);
    await seedReplay(team, a, { deck: [['ASH_010', 1]], side: [], when: '2026-06-01T00:00:00Z' });

    as(await seedUser('Outsider'));
    expect((await (await call(team, { ownLeader: 'Cad Bane' })).json()).ok).toBeFalsy();

    as(a);
    expect((await call(team, {})).status).toBe(400);
  });
});
