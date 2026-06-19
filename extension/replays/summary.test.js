// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// B170 / ADR 0010, Phase 2: the extension builds the plaintext "summary" the SW
// will encrypt — the small {players(leader/base/username), winner signal,
// ownerPlayerId} the webapp list/browse UIs decrypt to render a matchup card
// WITHOUT pulling the whole payload. Critically it must (a) carry no card/hand/
// deck plaintext, and (b) preserve the RAW winner signal so the webapp can
// normalize it with the SAME extractWinners it uses for plaintext replays (no
// duplicated winner logic — zero drift).
function loadDecoder() {
  const code = readFileSync(path.resolve(__dirname, '02-decoder.js'), 'utf8');
  // eslint-disable-next-line no-eval
  (0, eval)(code);
  return window.__KaraBuddy.replays.Decoder;
}

let D;
beforeEach(() => { localStorage.clear(); D = loadDecoder(); });
afterEach(() => { delete window.__KaraBuddy; });

// A v2 payload: first {full} carries leaders/bases/usernames + hands; a later
// {patch} sets the winner. Mirrors a real recording.
const payload = () => ({
  version: 2,
  localPlayerId: 'p1',
  events: [
    {
      t: 0, event: 'gamestate', args: [{ full: {
        id: 'game-xyz',
        players: {
          p1: {
            user: { username: 'Alice' },
            leader: { name: 'Luke', setId: { set: 'SOR', number: 1 } },
            base: { name: 'Echo Base', setId: { set: 'SOR', number: 20 } },
            cardPiles: { hand: [{ id: 'secret-card-1', name: 'Top Secret Tech' }] },
          },
          p2: {
            user: { username: 'Bob' },
            leader: { name: 'Vader', setId: { set: 'SOR', number: 10 } },
            base: { name: 'Command Center', setId: { set: 'SOR', number: 21 } },
            cardPiles: { hand: [{ id: 'secret-card-2' }] },
          },
        },
      } }],
    },
    { t: 100, event: 'gamestate', args: [{ patch: { 'winners': ['Alice'] } }] },
  ],
});

describe('buildEncryptedSummary', () => {
  it('extracts the matchup (leaders/bases/usernames keyed by playerId) + ownerPlayerId', () => {
    const s = D.buildEncryptedSummary(payload(), 'p1');
    expect(s.ownerPlayerId).toBe('p1');
    expect(s.players.p1.username).toBe('Alice');
    expect(s.players.p1.leader.name).toBe('Luke');
    expect(s.players.p1.leader.set).toBe('SOR');
    expect(s.players.p1.base.name).toBe('Echo Base');
    expect(s.players.p2.leader.name).toBe('Vader');
  });

  it('carries the RAW winner signal so the webapp normalizes it like a plaintext replay', () => {
    const s = D.buildEncryptedSummary(payload(), 'p1');
    expect(s.winners).toEqual(['Alice']);
    // No premature normalization in the extension — the webapp resolves
    // username→playerId against s.players via its existing extractWinners.
  });

  it('leaks NO card / hand / deck plaintext into the summary', () => {
    const s = D.buildEncryptedSummary(payload(), 'p1');
    const json = JSON.stringify(s);
    expect(json).not.toContain('secret-card-1');
    expect(json).not.toContain('Top Secret Tech');
    expect(json).not.toContain('cardPiles');
    expect(json).not.toContain('hand');
  });

  it('handles a payload with no winner yet (mid-match summary)', () => {
    const p = payload();
    p.events.pop(); // drop the winner patch
    const s = D.buildEncryptedSummary(p, 'p1');
    expect(s.winners == null || s.winners.length === 0).toBe(true);
    expect(s.players.p1.username).toBe('Alice');
  });
});
