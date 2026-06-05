import { describe, it, expect } from 'vitest';
import { extractReplayFacts, cardIdOf } from './statsExtract';
import { stripHiddenHandCards, HIDDEN_DATA_CARD_ID } from './replayDecoder';
import type { DecodedReplay, Frame } from './replayDecoder';

// B101/P0: pure fact extraction from a decoded replay. The two outputs that
// feed every downstream stat: ONE match_fact row (Tier A — leaders/bases/
// winner/format) and N card_events rows (Tier B — drawn/resourced/played/
// discarded, frame-diffed by uuid). The perspective-masking invariant is the
// crux: opponent hand cards are HIDDEN sentinels and opp deck/resources are
// face-down (no setId), so draw/resource events are recorder-side by
// construction while board events (played/discarded) are observed for both.

// Build a minimal card + a frame whose players each carry the given zones.
const card = (set: string, num: number, uuid: string, extra: any = {}) => ({
  uuid,
  setId: { set, number: num },
  id: `${set}_${String(num).padStart(3, '0')}`,
  ...extra,
});
const frame = (players: Record<string, any>, t = 0): Frame => ({ t, state: { players } });
const piles = (zones: Record<string, any[]>) => ({ cardPiles: zones });

function decodedFrom(frames: Frame[]): DecodedReplay {
  return {
    frames,
    sideEvents: [],
    activeByFrame: [],
    messagesByFrame: [],
    meta: { version: 2, match: { gameFormat: 'premier', cardPool: 'current', gamesToWinMode: 'bestOfThree' } },
    tags: [],
  } as any;
}

describe('cardIdOf', () => {
  it('formats SET_NNN with zero-padding and ignores hidden/invalid cards', () => {
    expect(cardIdOf(card('SOR', 1, 'u'))).toBe('SOR_001');
    expect(cardIdOf(card('JTL', 240, 'u'))).toBe('JTL_240');
    expect(cardIdOf({ uuid: 'h', setId: { set: 'REPLAYHIDDEN', number: 0 }, id: HIDDEN_DATA_CARD_ID })).toBeNull();
    expect(cardIdOf({ uuid: 'x' })).toBeNull();
  });
});

describe('extractReplayFacts — match fact', () => {
  it('captures leaders/bases/aspects/winner/format from the final frame', () => {
    const finalPlayers = {
      p1: {
        user: { username: 'Alice' },
        leader: { setId: { set: 'SOR', number: 1 }, aspects: ['command', 'heroism'] },
        base: { setId: { set: 'SOR', number: 20 }, aspects: ['command'] },
        cardPiles: {},
      },
      p2: {
        user: { username: 'Bob' },
        leader: { setId: { set: 'SHD', number: 5 }, aspects: ['aggression', 'villainy'] },
        base: { setId: { set: 'SHD', number: 9 }, aspects: ['aggression'] },
        cardPiles: {},
      },
    };
    const decoded = decodedFrom([frame(finalPlayers)]);
    const { matchFact } = extractReplayFacts(decoded, { gameId: 'g1', winners: ['p1'], ownerPlayerId: 'p1', durationMs: 600000 });
    expect(matchFact).not.toBeNull();
    expect(matchFact!.gameId).toBe('g1');
    expect(matchFact!.format).toBe('premier');
    expect(matchFact!.bo3).toBe(true);
    expect(matchFact!.result).toBe('decisive');
    const alice = matchFact!.players.find((p) => p.playerId === 'p1')!;
    const bob = matchFact!.players.find((p) => p.playerId === 'p2')!;
    expect(alice.leader).toBe('SOR_001');
    expect(alice.base).toBe('SOR_020');
    expect(alice.aspects.sort()).toEqual(['command', 'heroism']);
    expect(alice.isRecorder).toBe(true);
    expect(alice.won).toBe(true);
    expect(bob.isRecorder).toBe(false);
    expect(bob.won).toBe(false);
  });

  it('marks result unknown + won null when there is no winner signal (abandon/disconnect)', () => {
    const decoded = decodedFrom([frame({ p1: { user: { username: 'A' }, cardPiles: {} }, p2: { user: { username: 'B' }, cardPiles: {} } })]);
    const { matchFact } = extractReplayFacts(decoded, { gameId: 'g2', winners: null, ownerPlayerId: 'p1', durationMs: 1 });
    expect(matchFact!.result).toBe('unknown');
    expect(matchFact!.players.every((p) => p.won === null)).toBe(true);
  });

  it('derives Bo3 set linkage: lobbyId, gameNumber, and winner wins-after = winsBefore+1', () => {
    const decoded = decodedFrom([frame({ p1: { user: { username: 'A' }, cardPiles: {} }, p2: { user: { username: 'B' }, cardPiles: {} } })]);
    // Game 2 of a set, p1 leads 1-0 going in; p1 wins → set is now 2-0 (clinched).
    decoded.meta!.match = { gameFormat: 'premier', gamesToWinMode: 'bestOfThree', lobbyId: 'lob1', winHistory: { currentGameNumber: 2, winsPerPlayer: { p1: 1, p2: 0 } } } as any;
    const { matchFact } = extractReplayFacts(decoded, { gameId: 'g2', winners: ['p1'], ownerPlayerId: 'p1', durationMs: 1 });
    expect(matchFact!.bo3).toBe(true);
    expect(matchFact!.lobbyId).toBe('lob1');
    expect(matchFact!.gameNumber).toBe(2);
    expect(matchFact!.bo3WinsAfter).toBe(2); // 1 before + this win
  });

  it('leaves Bo3 linkage null for a Bo1 game', () => {
    const decoded = decodedFrom([frame({ p1: { user: { username: 'A' }, cardPiles: {} }, p2: { user: { username: 'B' }, cardPiles: {} } })]);
    decoded.meta!.match = { gameFormat: 'premier', gamesToWinMode: 'bestOfOne', lobbyId: 'lob2' } as any;
    const { matchFact } = extractReplayFacts(decoded, { gameId: 'g9', winners: ['p1'], ownerPlayerId: 'p1', durationMs: 1 });
    expect(matchFact!.bo3).toBe(false);
    expect(matchFact!.lobbyId).toBeNull();
    expect(matchFact!.bo3WinsAfter).toBeNull();
  });
});

describe('extractReplayFacts — card events', () => {
  it('derives drawn → resourced → played for the recorder, attributed recorder/both, with sideWon', () => {
    const draw = card('SOR', 100, 'c-draw');
    const res = card('SOR', 101, 'c-res');
    const play = card('SOR', 102, 'c-play');
    const frames = [
      // f0: all three in p1's deck
      frame({ p1: { ...piles({ deck: [draw, res, play], hand: [], resources: [], groundArena: [] }) }, p2: { ...piles({}) } }),
      // f1: drawn into hand
      frame({ p1: { ...piles({ deck: [], hand: [draw, res, play], resources: [], groundArena: [] }) }, p2: { ...piles({}) } }, 1),
      // f2: one resourced, one played to ground
      frame({ p1: { ...piles({ deck: [], hand: [draw], resources: [res], groundArena: [play] }) }, p2: { ...piles({}) } }, 2),
    ];
    const { cardEvents } = extractReplayFacts(decodedFrom(frames), { gameId: 'g3', winners: ['p1'], ownerPlayerId: 'p1', durationMs: 1 });
    const kinds = (cardId: string) => cardEvents.filter((e) => e.cardId === cardId).map((e) => e.event).sort();
    expect(kinds('SOR_100')).toEqual(['drawn']);
    expect(kinds('SOR_101')).toEqual(['drawn', 'resourced']);
    expect(kinds('SOR_102')).toEqual(['drawn', 'played']);
    const drawnEv = cardEvents.find((e) => e.cardId === 'SOR_100' && e.event === 'drawn')!;
    expect(drawnEv.attribution).toBe('recorder');
    expect(drawnEv.sideWon).toBe(true);
    const playedEv = cardEvents.find((e) => e.cardId === 'SOR_102' && e.event === 'played')!;
    expect(playedEv.attribution).toBe('both');
  });

  it('sees the OPPONENT card played (board-visible) but never their masked draws/resources', () => {
    const oppPlay = card('SHD', 50, 'o-play');
    // Opp hand is a HIDDEN sentinel (decoder masks it); opp deck face-down (no setId).
    const masked = { uuid: 'o-hand', setId: { set: 'REPLAYHIDDEN', number: 0 }, id: HIDDEN_DATA_CARD_ID };
    const frames = [
      // Opp hand is only the masked sentinel — a real card the opp will play is
      // NOT visible to us until it hits the board (that's the whole point of
      // masking). It first appears, as a real card, in the arena on f1.
      frame({ p1: { ...piles({}) }, p2: { ...piles({ hand: [masked], groundArena: [] }) } }),
      frame({ p1: { ...piles({}) }, p2: { ...piles({ hand: [masked], groundArena: [oppPlay] }) } }, 1),
    ];
    const { cardEvents } = extractReplayFacts(decodedFrom(frames), { gameId: 'g4', winners: ['p1'], ownerPlayerId: 'p1', durationMs: 1 });
    const oppEvents = cardEvents.filter((e) => e.playerId === 'p2');
    // Only the board-visible play of the real card; the masked card produces nothing.
    expect(oppEvents.map((e) => e.event)).toEqual(['played']);
    expect(oppEvents[0].cardId).toBe('SHD_050');
    expect(oppEvents[0].isRecorder).toBe(false);
    expect(oppEvents[0].attribution).toBe('both');
    expect(oppEvents[0].sideWon).toBe(false); // p2 lost
  });

  it('infers the recorder from the real-hand player when ownerPlayerId is absent', () => {
    const own = card('SOR', 200, 'own');
    const oppPlay = card('SHD', 60, 'op');
    const frames = [
      // p2 holds a real hand card → p2 is the recorder, even with no ownerPlayerId.
      frame({ p1: { ...piles({}) }, p2: { ...piles({ deck: [own], hand: [] }) } }),
      frame({ p1: { ...piles({ groundArena: [oppPlay] }) }, p2: { ...piles({ deck: [], hand: [own] }) } }, 1),
    ];
    const { cardEvents, matchFact } = extractReplayFacts(decodedFrom(frames), { gameId: 'g8', winners: null, ownerPlayerId: null, durationMs: 1 });
    const drawn = cardEvents.find((e) => e.event === 'drawn')!;
    expect(drawn.playerId).toBe('p2');
    expect(drawn.isRecorder).toBe(true); // inferred, despite ownerPlayerId=null
    // p1's board play is the non-recorder side.
    expect(cardEvents.find((e) => e.event === 'played')!.isRecorder).toBe(false);
    expect(matchFact!.players.find((p) => p.playerId === 'p2')!.isRecorder).toBe(true);
  });

  it('emits each (uuid,event) once even across many frames', () => {
    const c = card('SOR', 7, 'u7');
    const frames = [
      frame({ p1: { ...piles({ groundArena: [c] }) } }),
      frame({ p1: { ...piles({ groundArena: [c] }) } }, 1),
      frame({ p1: { ...piles({ groundArena: [c] }) } }, 2),
    ];
    const { cardEvents } = extractReplayFacts(decodedFrom(frames), { gameId: 'g5', winners: null, ownerPlayerId: 'p1', durationMs: 1 });
    expect(cardEvents.filter((e) => e.cardId === 'SOR_007' && e.event === 'played')).toHaveLength(1);
  });

  it('collects observedCards for catalog self-heal (real visible cards only)', () => {
    const c = card('JTL', 12, 'u', { name: 'Test Card', aspects: ['vigilance'], cost: 3, type: 'unit' });
    const decoded = decodedFrom([frame({ p1: { ...piles({ groundArena: [c] }) } })]);
    const { observedCards } = extractReplayFacts(decoded, { gameId: 'g6', winners: null, ownerPlayerId: 'p1', durationMs: 1 });
    expect(observedCards).toContainEqual(expect.objectContaining({ cardId: 'JTL_012', name: 'Test Card', cost: 3, type: 'unit' }));
  });
});

// Guard: feeding a decoder-masked state must not surface the sentinel as a card.
describe('masking integration', () => {
  it('a stripped opponent hand never yields a real cardId', () => {
    const masked = stripHiddenHandCards({ players: { opp: { cardPiles: { hand: [{ controllerId: 'opp' }] } } } });
    const decoded = decodedFrom([frame(masked.players)]);
    const { cardEvents } = extractReplayFacts(decoded, { gameId: 'g7', winners: null, ownerPlayerId: 'me', durationMs: 1 });
    expect(cardEvents).toHaveLength(0);
  });
});
