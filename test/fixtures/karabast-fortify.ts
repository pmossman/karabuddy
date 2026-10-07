// A replay payload with Fortify upgrades (Homeworlds, HMW): upgrades that attach
// to a BASE instead of a unit.
//
// SYNTHESIZED from forceteki's source, not captured from a live game. The shape
// is what SWU-Karabast/forceteki main (b40749c8, 2026-10-07) sends:
//   - BaseCard.getSummary (since #2657, 88e6f95c) nests them on the base:
//       players[pid].base.upgrades = [upgrade.getSummary(), …]
//     Fortify.spec.ts pins it: "The base upgrade is serialized to the client
//     nested on the base summary".
//   - They are NOT in any cardPiles entry: they live in the BaseZone, and
//     Player.getStateSummary only lists hand / outsideTheGame / capturedZone /
//     resources / groundArena / spaceArena / discard / credits.
//   - Each is an ordinary upgrade summary with zone 'base' and parentCardId =
//     the base's uuid (InPlayCard.getSummary). A Fortify upgrade can only attach
//     to its CONTROLLER's own base (InPlayCard.canAttachToTargetType), so the
//     cards on my base are mine. There can be several; most Fortify cards are
//     not unique.
//   - Power/HP are 0 (scripts/fetchdata.js defaults them for Fortify cards).
//   - Defeated, it goes to its owner's discard like any upgrade, with
//     parentCardId back to null.
//
// The story (p1 = Alice records; p2 = Bob, hidden hand):
//   f0  Bob's base already carries 2 fortifications; Alice's carries none.
//   f1  Alice plays Alliance Shield Generator from hand onto her base.
//   f2  Bob plays Sinister War Memorial (from his hidden hand) → 3 on his base.
//   f3  Alice attacks Bob's base for 3 (damage badge must stay readable).
//   f4  Bob plays Intelligence Agency → 4 on his base.
//   f5  Alice plays Confiscate to defeat Sinister War Memorial (a named tab) →
//       3 on Bob's base, Sinister War Memorial in Bob's discard.
//   f6  Bob attacks Alice's base for 3.

type Card = Record<string, any>;

export const P1 = 'p1';
export const P2 = 'p2';
export const P1_BASE_UUID = 'p1-base';
export const P2_BASE_UUID = 'p2-base';

// Card data (names, numbers, aspects, cids) from swu-db.
const cardData = {
  luke: { set: 'SOR', number: 5, cid: '2579145458', name: 'Luke Skywalker', aspects: ['vigilance', 'heroism'], type: 'leader', power: 4, hp: 7 },
  vader: { set: 'SOR', number: 10, cid: '6088773439', name: 'Darth Vader', aspects: ['aggression', 'villainy'], type: 'leader', power: 5, hp: 8 },
  duneSea: { set: 'HMW', number: 19, cid: '3333690969', name: 'Dune Sea', aspects: ['vigilance'], type: 'base', hp: 30 },
  brightTree: { set: 'HMW', number: 23, cid: '2826528227', name: 'Bright Tree Village', aspects: ['command'], type: 'base', hp: 30 },
  marine: { set: 'SOR', number: 95, cid: '4317911650', name: 'Battlefield Marine', aspects: ['command', 'heroism'], type: 'basicUnit', power: 3, hp: 3 },
  engineer: { set: 'JTL', number: 44, cid: '3660641793', name: 'Echo Base Engineer', aspects: ['vigilance', 'heroism'], type: 'basicUnit', power: 2, hp: 3 },
  trooper: { set: 'SOR', number: 128, cid: '2383321298', name: 'Death Star Stormtrooper', aspects: ['aggression', 'villainy'], type: 'basicUnit', power: 3, hp: 1 },
  tie: { set: 'SOR', number: 225, cid: '5562575456', name: 'TIE/ln Fighter', aspects: ['villainy'], type: 'basicUnit', power: 2, hp: 1 },
  confiscate: { set: 'SOR', number: 251, cid: '5950125325', name: 'Confiscate', aspects: [], type: 'event' },
  // Fortify upgrades.
  shieldGenerator: { set: 'HMW', number: 81, cid: '9829603191', name: 'Alliance Shield Generator', aspects: ['vigilance', 'heroism'], type: 'upgrade', power: 0, hp: 0 },
  darkSanctum: { set: 'HMW', number: 70, cid: '8622909461', name: 'Dark Sanctum', aspects: ['vigilance', 'villainy'], type: 'upgrade', power: 0, hp: 0 },
  militaryAcademy: { set: 'HMW', number: 112, cid: '1230090573', name: 'Military Academy', aspects: ['command', 'villainy'], type: 'upgrade', power: 0, hp: 0 },
  warMemorial: { set: 'HMW', number: 113, cid: '3798257647', name: 'Sinister War Memorial', aspects: ['command', 'villainy'], type: 'upgrade', power: 0, hp: 0 },
  intelAgency: { set: 'HMW', number: 205, cid: '5810314397', name: 'Intelligence Agency', aspects: ['cunning', 'villainy'], type: 'upgrade', power: 0, hp: 0 },
} as const;

export const FORT = {
  shieldGenerator: 'p1-asg',
  darkSanctum: 'p2-ds',
  militaryAcademy: 'p2-ma',
  warMemorial: 'p2-swm',
  intelAgency: 'p2-ia',
} as const;

// Card.getSummary (+ InPlayCard's parentCardId for in-play-capable cards).
function card(key: keyof typeof cardData, uuid: string, ctrl: string, zone: string, extra: Card = {}): Card {
  const d = cardData[key] as any;
  return {
    id: d.cid,
    setId: { set: d.set, number: d.number },
    controllerId: ctrl,
    ownerId: ctrl,
    aspects: [...d.aspects],
    zone,
    name: d.name,
    power: d.power ?? null,
    hp: d.hp ?? null,
    type: d.type,
    uuid,
    printedType: d.type,
    isBlanked: false,
    selectable: false,
    ...extra,
  };
}

const unit = (key: keyof typeof cardData, uuid: string, ctrl: string, zone: string, extra: Card = {}) =>
  card(key, uuid, ctrl, zone, { damage: 0, exhausted: false, parentCardId: null, sentinel: false, ...extra });

// A Fortify upgrade attached to `ctrl`'s base: zone 'base', parentCardId = base uuid.
export const fortification = (key: keyof typeof cardData, uuid: string, ctrl: string) =>
  card(key, uuid, ctrl, 'base', { parentCardId: ctrl === P1 ? P1_BASE_UUID : P2_BASE_UUID });

// The same card after it was defeated: owner's discard, parentCardId null.
const discarded = (key: keyof typeof cardData, uuid: string, ctrl: string) => card(key, uuid, ctrl, 'discard', { parentCardId: null });

const base = (key: keyof typeof cardData, uuid: string, ctrl: string, damage: number, upgrades: Card[]) =>
  card(key, uuid, ctrl, 'base', { damage, epicActionSpent: false, isDefender: false, upgrades });

const leader = (key: keyof typeof cardData, uuid: string, ctrl: string) =>
  card(key, uuid, ctrl, 'base', { onStartingSide: true, epicDeployActionSpent: false, exhausted: false, damage: 0 });

// The opponent's hand and resources reach the recorder as bare stubs.
const hiddenStub = (ctrl: string, zone: string) => ({ controllerId: ctrl, ownerId: ctrl, zone });

const player = (pid: string, username: string, fields: Card): Card => ({
  id: pid,
  name: username,
  user: { username },
  hasInitiative: pid === P1,
  availableResources: 4,
  aspects: pid === P1 ? ['vigilance', 'heroism'] : ['aggression', 'villainy', 'command'],
  forceToken: { active: false },
  credits: [],
  numCardsInDeck: 40,
  ...fields,
});

const playerPart = (name: string) => ({ type: 'player', name, id: name === 'Alice' ? P1 : P2 });
const cardPart = (c: Card) => ({ type: 'card', name: c.name, uuid: c.uuid, setId: c.setId, controllerId: c.controllerId, printedType: c.printedType, id: c.uuid, label: c.name });
const message = (...parts: any[]) => ({ date: '2026-10-07T12:00:00.000Z', message: parts });

export function fortifyPayload(opts: { gameId?: string; localPlayerId?: string } = {}) {
  // ── f0 ───────────────────────────────────────────────────────────────────
  const aliceHand = [
    card('shieldGenerator', FORT.shieldGenerator, P1, 'hand', { parentCardId: null }),
    card('confiscate', 'p1-confiscate', P1, 'hand'),
    unit('engineer', 'p1-engineer', P1, 'hand'),
  ];
  const aliceResources = [
    card('marine', 'p1-r1', P1, 'resource', { exhausted: false }),
    card('engineer', 'p1-r2', P1, 'resource', { exhausted: false }),
    card('tie', 'p1-r3', P1, 'resource', { exhausted: false }),
    card('trooper', 'p1-r4', P1, 'resource', { exhausted: false }),
  ];
  const marine = unit('marine', 'p1-marine', P1, 'groundArena');
  const trooper = unit('trooper', 'p2-trooper', P2, 'groundArena');
  const tie = unit('tie', 'p2-tie', P2, 'spaceArena');
  const bobForts0 = [
    fortification('darkSanctum', FORT.darkSanctum, P2),
    fortification('militaryAcademy', FORT.militaryAcademy, P2),
  ];

  const full = {
    id: opts.gameId ?? 'fortify-game',
    phase: 'action',
    roundNumber: 3,
    initiativeClaimed: false,
    winners: [],
    newMessages: [],
    players: {
      [P1]: player(P1, 'Alice', {
        leaders: [leader('luke', 'p1-leader', P1)],
        base: base('duneSea', P1_BASE_UUID, P1, 3, []),
        isActionPhaseActivePlayer: true,
        cardPiles: { hand: aliceHand, resources: aliceResources, groundArena: [marine], spaceArena: [], discard: [], outsideTheGame: [], capturedZone: [], credits: [] },
      }),
      [P2]: player(P2, 'Bob', {
        leaders: [leader('vader', 'p2-leader', P2)],
        base: base('brightTree', P2_BASE_UUID, P2, 5, bobForts0),
        isActionPhaseActivePlayer: false,
        cardPiles: {
          hand: [1, 2, 3, 4].map(() => hiddenStub(P2, 'hand')),
          resources: [1, 2, 3, 4, 5].map(() => hiddenStub(P2, 'resource')),
          groundArena: [trooper], spaceArena: [tie], discard: [], outsideTheGame: [], capturedZone: [], credits: [],
        },
      }),
    },
  };

  const asg = fortification('shieldGenerator', FORT.shieldGenerator, P1);
  const swm = fortification('warMemorial', FORT.warMemorial, P2);
  const ia = fortification('intelAgency', FORT.intelAgency, P2);
  const confiscateDiscard = card('confiscate', 'p1-confiscate', P1, 'discard');
  const active = (pid: string) => ({
    [`players/${P1}/isActionPhaseActivePlayer`]: pid === P1,
    [`players/${P2}/isActionPhaseActivePlayer`]: pid === P2,
  });

  const patches: Record<string, unknown>[] = [
    // f1 — Alice plays Alliance Shield Generator onto her own base.
    {
      ...active(P2),
      [`players/${P1}/cardPiles/hand`]: aliceHand.filter((c) => c.uuid !== FORT.shieldGenerator),
      [`players/${P1}/base/upgrades`]: [asg],
      [`players/${P1}/availableResources`]: 2,
      newMessages: [message(playerPart('Alice'), ' plays ', cardPart(asg), '', '', ', attaching it to ', cardPart(full.players[P1].base))],
    },
    // f2 — Bob plays Sinister War Memorial from his hidden hand.
    {
      ...active(P1),
      [`players/${P2}/cardPiles/hand`]: [1, 2, 3].map(() => hiddenStub(P2, 'hand')),
      [`players/${P2}/base/upgrades`]: [...bobForts0, swm],
      [`players/${P2}/availableResources`]: 2,
      newMessages: [message(playerPart('Bob'), ' plays ', cardPart(swm), '', '', ', attaching it to ', cardPart(full.players[P2].base))],
    },
    // f3 — Alice attacks Bob's base with Battlefield Marine for 3.
    {
      ...active(P2),
      [`players/${P1}/cardPiles/groundArena`]: [{ ...marine, exhausted: true }],
      [`players/${P2}/base/damage`]: 8,
      newMessages: [message(playerPart('Alice'), ' attacks ', playerPart('Bob'), "'s base with ", cardPart(marine))],
    },
    // f4 — Bob plays Intelligence Agency → four fortifications on his base.
    {
      ...active(P1),
      [`players/${P2}/cardPiles/hand`]: [1, 2].map(() => hiddenStub(P2, 'hand')),
      [`players/${P2}/base/upgrades`]: [...bobForts0, swm, ia],
      [`players/${P2}/availableResources`]: 1,
      newMessages: [message(playerPart('Bob'), ' plays ', cardPart(ia), '', '', ', attaching it to ', cardPart(full.players[P2].base))],
    },
    // f5 — Alice plays Confiscate to defeat Sinister War Memorial.
    {
      ...active(P2),
      [`players/${P1}/cardPiles/hand`]: [unit('engineer', 'p1-engineer', P1, 'hand')],
      [`players/${P1}/cardPiles/discard`]: [confiscateDiscard],
      [`players/${P1}/availableResources`]: 1,
      [`players/${P2}/base/upgrades`]: [...bobForts0, ia],
      [`players/${P2}/cardPiles/discard`]: [discarded('warMemorial', FORT.warMemorial, P2)],
      newMessages: [message(playerPart('Alice'), ' plays ', cardPart(confiscateDiscard), ' to defeat ', cardPart(swm))],
    },
    // f6 — Bob attacks Alice's base with Death Star Stormtrooper for 3.
    {
      ...active(P1),
      [`players/${P2}/cardPiles/groundArena`]: [{ ...trooper, exhausted: true }],
      [`players/${P1}/base/damage`]: 6,
      newMessages: [message(playerPart('Bob'), ' attacks ', playerPart('Alice'), "'s base with ", cardPart(trooper))],
    },
  ];

  return {
    version: 2,
    url: 'https://karabast.net/GameBoard',
    startedAt: '2026-10-07T12:00:00.000Z',
    durationMs: 7 * 4000,
    reason: 'manual',
    actionCount: patches.length,
    localPlayerId: opts.localPlayerId ?? P1,
    match: { gameFormat: 'premier', cardPool: 'current', gamesToWinMode: 'bestOfOne' },
    decks: null,
    events: [
      { t: 0, dir: 'in', event: 'gamestate', args: [{ full }] },
      ...patches.map((patch, i) => ({ t: (i + 1) * 4000, dir: 'in', event: 'gamestate', args: [{ patch }] })),
    ],
    tags: [],
  };
}
