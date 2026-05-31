import { describe, it, expect } from 'vitest';
import {
  applyPatch,
  stripHiddenHandCards,
  extractWinners,
  reconstructFinalState,
  extractSeenCards,
  HIDDEN_SET,
  HIDDEN_DATA_CARD_ID,
} from './replayDecoder';

// B79: the decoder is pure + central (winner extraction, opponent-hand masking,
// patch reconstruction, seen-cards) and has had several past bugs (B49/B59 POV +
// winner attribution, B65 seen-cards). It was previously untested.

describe('applyPatch', () => {
  it('creates nested paths and sets the leaf', () => {
    const state: any = {};
    applyPatch(state, { 'players/p1/cardPiles/hand': [1, 2] });
    expect(state.players.p1.cardPiles.hand).toEqual([1, 2]);
  });
  it('overwrites an existing leaf without clobbering siblings', () => {
    const state: any = { players: { p1: { hp: 10, name: 'A' } } };
    applyPatch(state, { 'players/p1/hp': 7 });
    expect(state.players.p1).toEqual({ hp: 7, name: 'A' });
  });
});

describe('stripHiddenHandCards', () => {
  it('replaces opponent hand stubs (no id/setId) with the styled sentinel', () => {
    const state = { players: { opp: { cardPiles: { hand: [{ controllerId: 'opp' }] } } } };
    const out = stripHiddenHandCards(state);
    const card = out.players.opp.cardPiles.hand[0];
    expect(card.id).toBe(HIDDEN_DATA_CARD_ID);
    expect(card.setId.set).toBe(HIDDEN_SET);
  });
  it('leaves real (visible) hand cards untouched', () => {
    const real = { id: 'SOR_001', setId: { set: 'SOR', number: 1 }, name: 'Real' };
    const state = { players: { me: { cardPiles: { hand: [real] } } } };
    expect(stripHiddenHandCards(state).players.me.cardPiles.hand[0]).toBe(real);
  });
});

describe('extractWinners', () => {
  const players = { p1: { user: { username: 'Alice' } }, p2: { user: { username: 'Bob' } } };
  it('normalizes a winner USERNAME to its playerId', () => {
    expect(extractWinners({ winners: ['Alice'], players })).toEqual(['p1']);
  });
  it('passes through a value that is already a playerId', () => {
    expect(extractWinners({ winner: 'p2', players })).toEqual(['p2']);
  });
  it('reads endGameInfo.winnerId', () => {
    expect(extractWinners({ endGameInfo: { winnerId: 'p1' }, players })).toEqual(['p1']);
  });
  it('returns null when no winner signal is present', () => {
    expect(extractWinners({ players })).toBeNull();
    expect(extractWinners({ winners: [] })).toBeNull();
    expect(extractWinners(null)).toBeNull();
  });
});

describe('reconstructFinalState', () => {
  it('seeds from {full} then applies {patch} deltas in order', () => {
    const parsed = {
      events: [
        { event: 'gamestate', args: [{ full: { players: { p1: { hp: 30 } } } }] },
        { event: 'gamestate', args: [{ patch: { 'players/p1/hp': 25 } }] },
        { event: 'gamestate', args: [{ patch: { 'players/p1/hp': 12 } }] },
      ],
    };
    expect(reconstructFinalState(parsed).players.p1.hp).toBe(12);
  });
  it('returns null when there is no gamestate', () => {
    expect(reconstructFinalState({ events: [{ event: 'other' }] })).toBeNull();
  });
});

describe('extractSeenCards', () => {
  const frameWith = (cards: any[]) => ({ state: { players: { opp: { cardPiles: { groundArena: cards } } } } }) as any;

  it('dedupes the same card instance (uuid) seen across many frames', () => {
    const card = { uuid: 'u1', setId: { set: 'SOR', number: 5 } };
    const seen = extractSeenCards([frameWith([card]), frameWith([card]), frameWith([card])], 'opp');
    expect(seen).toEqual([{ id: 'SOR_005', count: 1, cost: null }]);
  });

  it('counts distinct instances of the same card id as separate copies', () => {
    const seen = extractSeenCards(
      [frameWith([
        { uuid: 'a', setId: { set: 'SOR', number: 5 } },
        { uuid: 'b', setId: { set: 'SOR', number: 5 } },
      ])],
      'opp',
    );
    expect(seen).toEqual([{ id: 'SOR_005', count: 2, cost: null }]);
  });

  it('recurses into attached upgrades', () => {
    const host = { uuid: 'h', setId: { set: 'SOR', number: 5 }, upgrades: [{ uuid: 'up', setId: { set: 'SOR', number: 9 } }] };
    const ids = extractSeenCards([frameWith([host])], 'opp').map((c) => c.id).sort();
    expect(ids).toEqual(['SOR_005', 'SOR_009']);
  });

  it('ignores a player id that is not present', () => {
    expect(extractSeenCards([frameWith([{ uuid: 'x', setId: { set: 'SOR', number: 1 } }])], 'nobody')).toEqual([]);
  });
});
