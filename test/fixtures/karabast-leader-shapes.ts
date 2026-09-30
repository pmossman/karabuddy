// Replay payloads in both karabast player-leader shapes.
//
// OLD: players[pid].leader — every replay recorded before 2026-09-29.
// NEW: players[pid].leaders[] — SYNTHESIZED from SWU-Karabast/forceteki 028e5c97
//   (#2390, Player.getStateSummary: `leaders: this.getAllDeckLeaders().map(l =>
//   l.getSummary(activePlayer))`, no `leader` key) and forceteki-client e39400ed
//   (#822, Board reads `players[id].leaders?.[0]`). Not captured from a live game.

type Shape = 'old' | 'new';

const card = (set: string, number: number, name: string, aspects: string[], extra: Record<string, unknown> = {}) => ({
  id: `${set}_${String(number).padStart(3, '0')}`,
  setId: { set, number },
  name,
  aspects,
  uuid: `${set}-${number}-uuid`,
  ...extra,
});

export const VADER = card('SOR', 10, 'Darth Vader', ['aggression', 'villainy'], { type: 'leader', zone: 'base' });
export const LUKE = card('SOR', 5, 'Luke Skywalker', ['vigilance', 'heroism'], { type: 'leader', zone: 'base' });
export const LEIA = card('SOR', 9, 'Leia Organa', ['command', 'heroism'], { type: 'leader', zone: 'base' });
const BASE_A = card('SOR', 20, 'Dagobah Swamp', ['vigilance'], { type: 'base' });
const BASE_B = card('SOR', 22, 'Command Center', ['command'], { type: 'base' });

function player(shape: Shape, username: string, leaders: any[], base: any, hand: any[] = []) {
  const leaderFields = shape === 'old' ? { leader: leaders[0] } : { leaders };
  return { user: { username }, ...leaderFields, base, cardPiles: { hand, groundArena: [], spaceArena: [], discard: [], resources: [] } };
}

// p1 records; p2 plays twin leaders in the new shape (the old shape had one).
export function leaderShapePayload(shape: Shape, opts: { gameId?: string } = {}) {
  const p2Leaders = shape === 'new' ? [LUKE, LEIA] : [LUKE];
  const full = {
    id: opts.gameId ?? `game-${shape}`,
    phase: 'action',
    players: {
      p1: player(shape, 'Alice', [VADER], BASE_A, [card('SOR', 100, 'Some Unit', ['aggression'])]),
      p2: player(shape, 'Bob', p2Leaders, BASE_B),
    },
  };
  const deployedVader = { ...VADER, zone: 'groundArena', damage: 2 };
  const patch = shape === 'old'
    ? { 'players/p1/leader': deployedVader, winners: ['p1'] }
    : { 'players/p1/leaders': [deployedVader], winners: ['p1'] };
  return {
    version: 2,
    actionCount: 10,
    durationMs: 1000,
    localPlayerId: 'p1',
    events: [
      { t: 0, event: 'gamestate', args: [{ full }] },
      { t: 1, event: 'gamestate', args: [{ patch }] },
    ],
    tags: [],
  };
}
