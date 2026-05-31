// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// B79: pure-logic coverage for 02-decoder — the author/POV + game-end +
// diffing helpers behind several past bugs (B32/B33/B49 author attribution,
// B26/B29 game-end-driven uploads). Previously untested.

function loadDecoder() {
  const code = readFileSync(path.resolve(__dirname, '02-decoder.js'), 'utf8');
  // eslint-disable-next-line no-eval
  (0, eval)(code);
  return window.__KaraBuddy.replays.Decoder;
}

let D;
beforeEach(() => { localStorage.clear(); D = loadDecoder(); });
afterEach(() => { delete window.__KaraBuddy; });

describe('getOrCreateAuthor (B49 — attribute to the LOCAL player, not iteration order)', () => {
  const players = { p1: { user: { username: 'Alice' } }, p2: { user: { username: 'Bob' } } };
  it('returns the local player’s username when localPlayerId is known', () => {
    expect(D.getOrCreateAuthor(players, 'p2')).toBe('Bob');
  });
  it('falls back to a persisted anon handle when the local player is anonymous/unknown', () => {
    const a = D.getOrCreateAuthor({ p1: { user: { username: 'anonymous 123' } } }, 'p1');
    expect(a).toMatch(/^anon-/);
    // Stable across calls (persisted in localStorage).
    expect(D.getOrCreateAuthor(null, null)).toBe(a);
  });
});

describe('playerColorFor', () => {
  it('uses the PLAYER color for a username in the player set, REVIEWER otherwise', () => {
    expect(D.playerColorFor('Alice', new Set(['Alice', 'Bob']))).toBe(D.TAG_COLOR_PLAYER);
    expect(D.playerColorFor('Carol', new Set(['Alice', 'Bob']))).toBe(D.TAG_COLOR_REVIEWER);
  });
  it('accepts array / object username collections and defaults to REVIEWER with none', () => {
    expect(D.playerColorFor('Alice', ['Alice'])).toBe(D.TAG_COLOR_PLAYER);
    expect(D.playerColorFor('Alice', { 0: 'Alice' })).toBe(D.TAG_COLOR_PLAYER);
    expect(D.playerColorFor('Alice', null)).toBe(D.TAG_COLOR_REVIEWER);
  });
});

describe('looksLikeGameEnd', () => {
  it('detects each end-of-game signal shape', () => {
    expect(D.looksLikeGameEnd({ winners: ['p1'] })).toBe(true);
    expect(D.looksLikeGameEnd({ winner: 'p1' })).toBe(true);
    expect(D.looksLikeGameEnd({ endGameInfo: {} })).toBe(true);
    expect(D.looksLikeGameEnd({ gameOver: true })).toBe(true);
    expect(D.looksLikeGameEnd({ phase: 'endgame' })).toBe(true);
  });
  it('false for a mid-game state', () => {
    expect(D.looksLikeGameEnd({ phase: 'action', winners: [] })).toBe(false);
    expect(D.looksLikeGameEnd(null)).toBe(false);
  });
});

describe('isAnonymousUsername', () => {
  it('treats empty + "anonymous …" as anonymous, real handles as not', () => {
    expect(D.isAnonymousUsername('')).toBe(true);
    expect(D.isAnonymousUsername(null)).toBe(true);
    expect(D.isAnonymousUsername('anonymous 4831')).toBe(true);
    expect(D.isAnonymousUsername('ReprintConfiscate')).toBe(false);
  });
});

describe('makePatch + applyPatch round-trip', () => {
  it('a diff applied to a clone of the old state reproduces the new state', () => {
    const oldS = { players: { p1: { hp: 30, hand: [1] } }, phase: 'action' };
    const newS = { players: { p1: { hp: 24, hand: [1, 2] } }, phase: 'action' };
    const patch = D.makePatch(oldS, newS);
    const clone = JSON.parse(JSON.stringify(oldS));
    D.applyPatch(clone, patch);
    expect(clone).toEqual(newS);
  });
});

describe('detectLocalPlayerId (B33 — POV via hand-visibility asymmetry)', () => {
  const visibleHand = [{ id: 'SOR_001', setId: { set: 'SOR', number: 1 } }];
  const stubHand = [{ controllerId: 'x' }]; // masked opponent hand (no id/setId)

  it('returns the unique player whose hand has visible card data', () => {
    const players = { p1: { cardPiles: { hand: stubHand } }, p2: { cardPiles: { hand: visibleHand } } };
    expect(D.detectLocalPlayerId(players)).toBe('p2');
  });
  it('returns null when both or neither hands are visible (ambiguous)', () => {
    expect(D.detectLocalPlayerId({ p1: { cardPiles: { hand: visibleHand } }, p2: { cardPiles: { hand: visibleHand } } })).toBeNull();
    expect(D.detectLocalPlayerId({ p1: { cardPiles: { hand: stubHand } }, p2: { cardPiles: { hand: stubHand } } })).toBeNull();
    expect(D.detectLocalPlayerId(null)).toBeNull();
  });
});

describe('analyzeRecording (B75 — per-player upload threshold)', () => {
  // Each gamestate full marks exactly one player as the action-phase active
  // player; a NEW active player (transition) counts as one action for them.
  const turn = (activePid) => ({
    event: 'gamestate',
    args: [{ full: { players: { p1: { isActionPhaseActivePlayer: activePid === 'p1' }, p2: { isActionPhaseActivePlayer: activePid === 'p2' } } } }],
  });

  it('tallies actions per player; minPlayerActions is the min across players', () => {
    // p1,p2,p1,p2,p1 → p1=3, p2=2
    const r = D.analyzeRecording([turn('p1'), turn('p2'), turn('p1'), turn('p2'), turn('p1')]);
    expect(r).toEqual({ actionCount: 5, distinctActivePlayers: 2, minPlayerActions: 2 });
  });

  it('does not double-count consecutive frames with the same active player', () => {
    const r = D.analyzeRecording([turn('p1'), turn('p1'), turn('p2')]);
    expect(r).toEqual({ actionCount: 2, distinctActivePlayers: 2, minPlayerActions: 1 });
  });

  it('minPlayerActions is 0 when fewer than two players acted (rage-quit guard)', () => {
    expect(D.analyzeRecording([turn('p1'), turn('p1')]).minPlayerActions).toBe(0);
    expect(D.analyzeRecording([]).minPlayerActions).toBe(0);
  });

  it('applies patch deltas to track the active-player transition', () => {
    const events = [
      turn('p1'),
      { event: 'gamestate', args: [{ patch: { 'players/p1/isActionPhaseActivePlayer': false, 'players/p2/isActionPhaseActivePlayer': true } }] },
    ];
    const r = D.analyzeRecording(events);
    expect(r.distinctActivePlayers).toBe(2);
    expect(r.minPlayerActions).toBe(1);
  });
});
