// Synthesizes a minimal-but-valid replay payload — what the extension
// would upload at game-end. The server route validates: version 2,
// has a firstGamestate with `.full.id` + `.players`, ≤ 8 MB. We add
// enough player + cardPiles structure that the viewer's decoder picks
// the right POV (hand-visibility asymmetry per B33).
//
// Reused across E2E tests that need a real replay in the DB. The shape
// is faithful to what 03-recorder.js's buildPayloadText produces.

import { randomUUID } from 'node:crypto';

export interface SyntheticReplayOpts {
  // If provided, fixes the gameId (useful when testing snapshot upsert).
  gameId?: string;
  // Local player's username + id. Their hand will have visible cards
  // (the signal POV detection uses). `discardCards` (optional) populates the
  // local player's discard pile so tests can exercise the pile viewer.
  local: { id?: string; username: string; leaderName?: string; discardCards?: Array<{ set: string; number: number }> };
  // Opponent's username. Hand stays empty (no visibility) so they're
  // not picked as POV. `seenCards` (optional) gets injected into the
  // opponent's groundArena so tests can exercise the "seen during play"
  // extraction without authoring multi-frame fixtures.
  opponent: {
    id?: string;
    username: string;
    leaderName?: string;
    seenCards?: Array<{ set: string; number: number; uuid?: string }>;
  };
  // Optional tags to embed. B71: teamSlugs narrows a tag's audience
  // (subset of the armed shareTeamSlugs); omitted → defaults to the shares.
  tags?: Array<{ id?: string; frameIndex?: number; author?: string; comment?: string; mentions?: { userIds: string[]; teamSlugs: string[] }; teamSlugs?: string[] }>;
  // Optional match metadata (B42).
  match?: {
    gameFormat?: string;
    cardPool?: string;
    gamesToWinMode?: string;
    // B116: stable across a Bo3's games — set the same value on multiple uploads
    // to exercise series grouping in the replay browser.
    lobbyId?: string;
  };
  // Optional winner playerId list (B59). When provided, the final
  // gamestate's `winners` field is populated so the upload route's
  // extractor picks it up + persists.
  winners?: string[];
  // If true, emit the winners via a `{patch: {winners: [...]}}` event
  // AFTER the initial full snapshot — matches karabast's real recorder
  // format (full at start, patches after). Default false (emits via
  // the full snapshot directly) for older tests that haven't moved.
  winnersViaPatch?: boolean;
  // B102: extra gamestate patch events appended after the initial full, to
  // exercise undo + board-static collapse in the viewer. Each entry is a
  // patch object merged onto the running state (e.g. `{ phase: 'B' }` to move
  // to a new board position, repeating a prior patch = an undo, or
  // `{ newMessages: ['x'] }` = a board-static log-only frame).
  extraGamestatePatches?: Record<string, any>[];
  // Optional deck snapshot (B42). When provided, the upload route persists
  // it into the `decks` jsonb column, which the deck page (B58) renders.
  // Shape is `Record<playerId, UserDeck>` from lib/replayDecoder.
  decks?: Record<string, {
    username: string | null;
    name?: string | null;
    leader: { id: string; count: number; cost?: number | null } | null;
    base: { id: string; count: number; cost?: number | null } | null;
    deck: Array<{ id: string; count: number; cost?: number | null }> | null;
    sideboard: Array<{ id: string; count: number; cost?: number | null }> | null;
  }>;
}

export function syntheticReplayPayload(opts: SyntheticReplayOpts): {
  payload: string;
  gameId: string;
  localPlayerId: string;
} {
  const gameId = opts.gameId ?? randomUUID();
  const localPlayerId = opts.local.id ?? randomUUID();
  const opponentPlayerId = opts.opponent.id ?? randomUUID();

  const localCard = {
    id: 'ASH_005',
    setId: { set: 'ASH', number: 5 },
    name: 'Luke',
    type: 'unit',
    uuid: 'card-1',
  };

  const players: Record<string, any> = {
    [localPlayerId]: {
      user: { username: opts.local.username },
      leader: {
        id: 'ASH_005',
        setId: { set: 'ASH', number: 5 },
        name: opts.local.leaderName ?? 'Luke Skywalker',
        type: 'leader',
        uuid: 'leader-local',
      },
      base: {
        id: 'JTL_024',
        setId: { set: 'JTL', number: 24 },
        name: 'Tarkintown',
        type: 'base',
        uuid: 'base-local',
      },
      cardPiles: {
        hand: [localCard],
        deck: [],
        discard: (opts.local.discardCards || []).map((c, i) => ({
          id: `${c.set}_${String(c.number).padStart(3, '0')}`,
          setId: { set: c.set, number: c.number },
          name: `${c.set} ${c.number}`,
          type: 'unit',
          uuid: `local-discard-${i}`,
        })),
        resources: [],
        groundArena: [],
        spaceArena: [],
        capturedZone: [],
      },
      isActionPhaseActivePlayer: true,
    },
    [opponentPlayerId]: {
      user: { username: opts.opponent.username },
      leader: {
        id: 'ASH_014',
        setId: { set: 'ASH', number: 14 },
        name: opts.opponent.leaderName ?? 'The Mandalorian',
        type: 'leader',
        uuid: 'leader-opp',
      },
      base: {
        id: 'JTL_024',
        setId: { set: 'JTL', number: 24 },
        name: 'Tarkintown',
        type: 'base',
        uuid: 'base-opp',
      },
      cardPiles: {
        hand: [], // empty = no visibility = not POV
        deck: [],
        discard: [],
        resources: [],
        // Inject any opt-in opponent-seen cards into the ground arena.
        groundArena: (opts.opponent.seenCards || []).map((c, i) => ({
          id: `${c.set}_${String(c.number).padStart(3, '0')}`,
          setId: { set: c.set, number: c.number },
          name: `${c.set} ${c.number}`,
          type: 'unit',
          uuid: c.uuid ?? `opp-seen-${i}`,
        })),
        spaceArena: [],
        capturedZone: [],
      },
      isActionPhaseActivePlayer: false,
    },
  };

  // Second gamestate so distinctActivePlayers >= 2 if you flip both
  // active flags. For now one is enough — we don't exercise that gate
  // server-side.
  const initialWinners = opts.winners && !opts.winnersViaPatch ? opts.winners : undefined;
  const events: any[] = [
    {
      t: 0,
      dir: 'in',
      event: 'gamestate',
      args: [{ full: { id: gameId, players, ...(initialWinners ? { winners: initialWinners } : {}) } }],
    },
  ];
  if (opts.winners && opts.winnersViaPatch) {
    // Mirror karabast: the initial full snapshot has no winners, then a
    // later patch sets them when the match resolves.
    events.push({
      t: 1,
      dir: 'in',
      event: 'gamestate',
      args: [{ patch: { winners: opts.winners } }],
    });
  }
  // B102: append extra gamestate patches (collapse fixtures).
  for (let i = 0; i < (opts.extraGamestatePatches?.length ?? 0); i++) {
    events.push({
      t: 10 + i,
      dir: 'in',
      event: 'gamestate',
      args: [{ patch: opts.extraGamestatePatches![i] }],
    });
  }

  const payload = JSON.stringify({
    version: 2,
    url: 'https://karabast.net/GameBoard',
    startedAt: new Date().toISOString(),
    durationMs: 60_000,
    reason: 'manual',
    actionCount: 1,
    localPlayerId,
    match: opts.match ?? null,
    decks: opts.decks ?? null,
    events,
    tags: opts.tags ?? [],
  });

  return { payload, gameId, localPlayerId };
}
