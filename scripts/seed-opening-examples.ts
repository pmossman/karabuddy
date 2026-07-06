// Local-only seed: a team with MANY members and several completed openings,
// spanning the full spread of outcomes (full consensus, picks-differ,
// decision split, mulligan forks) so the reveal's per-member layout can be
// eyeballed with a crowd. NOT for prod — it writes fake replays with dummy
// blob URLs (the reveal reads players+opening from Postgres, not the blob;
// only "Watch the opening" needs the blob, which these don't have).
//
// Run against the LOCAL Docker DB:
//   KARABUDDY_DB_DRIVER=pg POSTGRES_URL="postgres://…localhost:5434/…" \
//     npx tsx scripts/seed-opening-examples.ts
//
// Prints the team slug + invite so the current user can review it. The
// signed-in viewer (parkermos@gmail.com, "Skyler Vance") is added as a member
// with their own answer seeded, so the openings show up under Answered and
// clicking one opens the full reveal with everyone's hands.

import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db';
import { users, teams, teamMembers, replays, replayTeamShares, openingResponses, replayOpenings, tags, tagTeamScope } from '../lib/schema';
import { decodeReplay } from '../lib/replayDecoder';
import { persistOpening } from '../lib/openingPersist';
import { eq } from 'drizzle-orm';

const VIEWER_EMAIL = 'parkermos@gmail.com';

// A recognizable roster of 8 teammates.
const MEMBER_NAMES = ['Ace Kallig', 'Bex Trell', 'Cass Vane', 'Dov Marek', 'Enna Sol', 'Fenn Rook', 'Gia Nadir', 'Hux Roan'];

// Card pool for building hands (real set/number pairs so art loads).
const POOL: [string, number][] = [
  ['SOR', 66], ['SOR', 47], ['SHD', 125], ['SHD', 126], ['TWI', 40], ['JTL', 61],
  ['SOR', 100], ['SOR', 101], ['SHD', 102], ['TWI', 103], ['JTL', 104], ['JTL', 105],
];
const cardId = (set: string, n: number) => `${set}_${String(n).padStart(3, '0')}`;

// Leaders/bases per opening for visual variety.
const MATCHUPS = [
  { own: { leader: ['Cad Bane', 'SHD', 3], base: ['Command Center', 'SOR', 20] }, opp: { leader: ['Boba Fett', 'SOR', 9], base: ['Shadowed Undercity', 'SHD', 22] } },
  { own: { leader: ['Luke Skywalker', 'SOR', 5], base: ['Lake Country', 'JTL', 31] }, opp: { leader: ['Darth Vader', 'SOR', 10], base: ['Lair of Grievous', 'TWI', 27] } },
  { own: { leader: ['Leia Organa', 'TWI', 7], base: ['Colossus', 'JTL', 30] }, opp: { leader: ['Grand Moff Tarkin', 'SOR', 12], base: ['Kestro City', 'SOR', 27] } },
  { own: { leader: ['Sabine Wren', 'TWI', 14], base: ['Chopper Base', 'TWI', 25] }, opp: { leader: ['The Mandalorian', 'SHD', 6], base: ['Death Watch Hideout', 'SHD', 23] } },
];

function buildPayload(gameId: string, m: (typeof MATCHUPS)[number], recorderMulligan: boolean, recorderName: string) {
  let uu = 0;
  const card = (set: string, num: number) => ({ setId: { set, number: num }, name: `${set} ${num}`, uuid: `u${uu++}` });
  const masked = () => ({ uuid: `m${uu++}` });
  const allPiles = (piles: { hand?: any[]; resources?: any[] }) => ({
    hand: piles.hand ?? [], resources: piles.resources ?? [], deck: [], discard: [], groundArena: [], spaceArena: [], capturedZone: [],
  });
  const dealt = POOL.slice(0, 6).map(([s, n]) => card(s, n));
  const redraw = POOL.slice(6, 12).map(([s, n]) => card(s, n));
  const kept = recorderMulligan ? redraw : dealt;
  const resourced = [kept[1], kept[4]]; // recorder resources index 1 + 4
  const after = kept.filter((c) => c !== resourced[0] && c !== resourced[1]);
  const idOf = (c: any) => cardId(c.setId.set, c.setId.number);

  const seat = (piles: any) => ({
    user: { username: recorderName }, hasInitiative: true,
    leader: { name: m.own.leader[0], setId: { set: m.own.leader[1], number: m.own.leader[2] } },
    base: { name: m.own.base[0], setId: { set: m.own.base[1], number: m.own.base[2] } },
    cardPiles: allPiles(piles),
  });
  const opp = (hand: any[]) => ({
    user: { username: 'Rival' }, hasInitiative: false,
    leader: { name: m.opp.leader[0], setId: { set: m.opp.leader[1], number: m.opp.leader[2] } },
    base: { name: m.opp.base[0], setId: { set: m.opp.base[1], number: m.opp.base[2] } },
    cardPiles: allPiles({ hand }),
  });
  const frame = (phase: string, mine: any, oppHand: any[]) => ({
    event: 'gamestate', args: [{ full: { id: gameId, phase, players: { p1: seat(mine), p2: opp(oppHand) } } }],
  });
  const frames: any[] = [frame('setup', {}, []), frame('setup', { hand: dealt }, Array(6).fill(0).map(masked))];
  if (recorderMulligan) frames.push(frame('setup', { hand: redraw }, Array(6).fill(0).map(masked)));
  frames.push(frame('setup', { hand: after, resources: resourced }, Array(6).fill(0).map(masked)));
  frames.push(frame('action', { hand: after, resources: resourced }, Array(4).fill(0).map(masked)));

  const payload = JSON.stringify({ version: 2, actionCount: 10, durationMs: 1000, localPlayerId: 'p1', events: frames, tags: [] });
  return {
    payload,
    dealtIds: dealt.map(idOf),
    keptIds: kept.map(idOf),
    resourcedIds: resourced.map(idOf),
  };
}

async function ensureUser(db: any, name: string, email: string): Promise<string> {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return existing.id;
  const id = randomUUID();
  await db.insert(users).values({ id, name, email });
  return id;
}

async function main() {
  const db = getDb();
  if (!process.env.POSTGRES_URL?.includes('localhost')) {
    throw new Error('Refusing to seed: POSTGRES_URL is not localhost. This is a LOCAL-only script.');
  }

  const viewerId = (await db.select().from(users).where(eq(users.email, VIEWER_EMAIL)))[0]?.id
    ?? (await ensureUser(db, 'Skyler Vance', VIEWER_EMAIL));

  const memberIds: string[] = [];
  for (let i = 0; i < MEMBER_NAMES.length; i++) {
    memberIds.push(await ensureUser(db, MEMBER_NAMES[i], `opening-lab-${i}@example.com`));
  }

  const slug = `openlab-${randomUUID().slice(0, 6)}`;
  await db.insert(teams).values({ slug, name: 'Opening Lab', createdBy: viewerId }).onConflictDoNothing();
  await db.insert(teamMembers).values([
    { teamSlug: slug, userId: viewerId, role: 'owner' },
    ...memberIds.map((id) => ({ teamSlug: slug, userId: id, role: 'member' as const })),
  ]).onConflictDoNothing();

  // Per-opening scenario: recorder decision + a designed spread of member
  // answers. `mode` picks how each answerer diverges.
  const OPENINGS: { title: string; recorderMulligan: boolean; recorderIsMember: number; answers: { who: 'viewer' | number; decision: 'keep' | 'mulligan'; mode: 'exact' | 'onepick' | 'diffpicks' | 'fork' }[] }[] = [
    {
      title: 'Recorder KEEP — near consensus', recorderMulligan: false, recorderIsMember: 0,
      answers: [
        { who: 'viewer', decision: 'keep', mode: 'exact' },
        { who: 1, decision: 'keep', mode: 'exact' }, { who: 2, decision: 'keep', mode: 'exact' },
        { who: 3, decision: 'keep', mode: 'onepick' }, { who: 4, decision: 'keep', mode: 'exact' },
        { who: 5, decision: 'keep', mode: 'exact' }, { who: 6, decision: 'mulligan', mode: 'fork' },
      ],
    },
    {
      title: 'Recorder KEEP — picks all over the place', recorderMulligan: false, recorderIsMember: 1,
      answers: [
        { who: 'viewer', decision: 'keep', mode: 'diffpicks' },
        { who: 0, decision: 'keep', mode: 'onepick' }, { who: 2, decision: 'keep', mode: 'diffpicks' },
        { who: 3, decision: 'keep', mode: 'exact' }, { who: 4, decision: 'keep', mode: 'onepick' },
        { who: 5, decision: 'keep', mode: 'diffpicks' }, { who: 6, decision: 'keep', mode: 'onepick' },
        { who: 7, decision: 'keep', mode: 'exact' },
      ],
    },
    {
      title: 'Recorder MULLIGAN — team split on the call', recorderMulligan: true, recorderIsMember: 2,
      answers: [
        { who: 'viewer', decision: 'mulligan', mode: 'exact' },
        { who: 0, decision: 'mulligan', mode: 'onepick' }, { who: 1, decision: 'keep', mode: 'fork' },
        { who: 3, decision: 'mulligan', mode: 'exact' }, { who: 4, decision: 'keep', mode: 'fork' },
        { who: 5, decision: 'mulligan', mode: 'diffpicks' }, { who: 6, decision: 'keep', mode: 'fork' },
        { who: 7, decision: 'mulligan', mode: 'exact' },
      ],
    },
    {
      title: 'Recorder MULLIGAN — unanimous mulligan, mixed picks', recorderMulligan: true, recorderIsMember: 3,
      answers: [
        { who: 'viewer', decision: 'mulligan', mode: 'onepick' },
        { who: 0, decision: 'mulligan', mode: 'exact' }, { who: 1, decision: 'mulligan', mode: 'exact' },
        { who: 2, decision: 'mulligan', mode: 'diffpicks' }, { who: 4, decision: 'mulligan', mode: 'exact' },
        { who: 5, decision: 'mulligan', mode: 'onepick' }, { who: 6, decision: 'mulligan', mode: 'exact' },
        { who: 7, decision: 'mulligan', mode: 'diffpicks' },
      ],
    },
  ];

  const idFor = (who: 'viewer' | number) => (who === 'viewer' ? viewerId : memberIds[who]);

  const COMMENTS_BY_OPENING: Record<number, { who: 'viewer' | number; text: string }[]> = {
    0: [
      { who: 1, text: 'Standard keep — resource the two events, hold the units. No-brainer here.' },
      { who: 3, text: 'I get keeping, but I resourced the Skirmisher instead — I want tempo turn 1.' },
      { who: 'viewer', text: 'Agree with the keep. Curve is too good to ship.' },
    ],
    1: [
      { who: 0, text: 'Way too much disagreement on the resources for a "keep". What are we prioritizing?' },
      { who: 2, text: 'Depends on the matchup — vs aggro I keep the cheap units, vs control the events.' },
    ],
    2: [
      { who: 1, text: 'This is a snap KEEP for me, not a mulligan. Two playables + a base is fine.' },
      { who: 4, text: 'Yeah the recorder over-mulliganed imo. This hand does enough.' },
      { who: 'viewer', text: 'I mulliganed too but I see the argument for keeping. Close one.' },
    ],
    3: [
      { who: 5, text: 'Unanimous mulligan — that dealt hand had zero early plays.' },
    ],
  };

  // Given an answerer's decision + mode, choose their 2 resourced cardIds.
  function picksFor(decision: 'keep' | 'mulligan', mode: string, hands: { dealtIds: string[]; keptIds: string[]; resourcedIds: string[] }) {
    const src = decision === 'keep' ? hands.dealtIds : hands.keptIds;
    const rec = hands.resourcedIds; // recorder's picks (from keptIds)
    switch (mode) {
      case 'exact':
        // Only meaningful when comparable (same hand as recorder). Fall back
        // to the recorder's picks if they exist in this source hand.
        return rec.every((id) => src.includes(id)) ? [...rec] : [src[1], src[4]];
      case 'onepick': {
        // One matches the recorder, one differs.
        const match = rec.find((id) => src.includes(id)) ?? src[1];
        const other = src.find((id) => id !== match && !rec.includes(id)) ?? src[0];
        return [match, other];
      }
      case 'diffpicks': {
        const avoid = new Set(rec);
        const picks = src.filter((id) => !avoid.has(id)).slice(0, 2);
        return picks.length === 2 ? picks : [src[0], src[2]];
      }
      case 'fork':
      default:
        // Divergent decision — picks come from their own world.
        return [src[0], src[3]];
    }
  }

  let made = 0;
  for (const o of OPENINGS) {
    const recorderId = memberIds[o.recorderIsMember];
    const m = MATCHUPS[made % MATCHUPS.length];
    const gameId = `g-${randomUUID()}`;
    const hands = buildPayload(gameId, m, o.recorderMulligan, MEMBER_NAMES[o.recorderIsMember]);
    const rslug = `r_${randomUUID().slice(0, 8)}`;
    const parsed = JSON.parse(hands.payload);

    // Players array, exactly as the upload route derives it.
    const snap = parsed.events[0].args[0].full;
    const players = Object.entries(snap.players).map(([id, p]: [string, any]) => ({
      id,
      username: p.user?.username || '',
      leader: p.leader ? { name: p.leader.name, set: p.leader.setId.set, number: p.leader.setId.number } : null,
      base: p.base ? { name: p.base.name, set: p.base.setId.set, number: p.base.setId.number } : null,
    }));

    await db.insert(replays).values({
      slug: rslug, gameId, userId: recorderId, ownerToken: `kbx_${randomUUID()}`,
      players, durationMs: 1000, actionCount: 10,
      payloadBlobUrl: 'memory://seed', payloadSizeBytes: hands.payload.length,
      match: { gameFormat: 'premier' }, winners: null, ownerPlayerId: 'p1',
    } as any);

    const decoded = decodeReplay(parsed);
    const ok = await persistOpening(decoded, rslug);
    if (!ok) { console.log(`  ! opening extraction failed for "${o.title}" — skipping`); continue; }

    await db.insert(replayTeamShares).values({ replaySlug: rslug, teamSlug: slug, sharedBy: recorderId }).onConflictDoNothing();

    const rows = o.answers.map((a) => ({
      replaySlug: rslug,
      userId: idFor(a.who),
      decision: a.decision,
      resourced: picksFor(a.decision, a.mode, hands),
    }));
    await db.insert(openingResponses).values(rows).onConflictDoNothing();

    // A little discussion so the reveal's comment panel isn't empty. Anchor
    // at the opening's mulligan (decision) frame; scope to the team so members
    // see it.
    const [op] = await db.select().from(replayOpenings).where(eq(replayOpenings.replaySlug, rslug));
    const frame = op?.mulliganFrameIndex ?? 1;
    const comments = COMMENTS_BY_OPENING[made] ?? [];
    for (let ci = 0; ci < comments.length; ci++) {
      const c = comments[ci];
      const authorId = c.who === 'viewer' ? viewerId : memberIds[c.who];
      const authorName = c.who === 'viewer' ? 'Skyler Vance' : MEMBER_NAMES[c.who];
      const tagId = `t_${randomUUID().slice(0, 10)}`;
      await db.insert(tags).values({
        id: tagId, replaySlug: rslug, frameIndex: frame, userId: authorId,
        authorToken: `kbx_${randomUUID()}`, authorName, comment: c.text,
      } as any).onConflictDoNothing();
      await db.insert(tagTeamScope).values({ tagId, teamSlug: slug }).onConflictDoNothing();
    }

    made++;
    console.log(`  ✓ ${o.title}  (recorder ${o.recorderMulligan ? 'mulligan' : 'keep'}, ${o.answers.length} answers)`);
  }

  console.log(`\nSeeded ${made} openings into team "Opening Lab".`);
  console.log(`  Team slug: ${slug}`);
  console.log(`  View: reload, switch to "Opening Lab" in the team switcher → Openings → Answered.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
