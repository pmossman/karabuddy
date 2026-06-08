import { describe, it, expect } from 'vitest';
import { serializeReplayRow } from '@/lib/replayRow';

// B116: the shared replay-browser row serializer. The crux is PERSPECTIVE —
// ownLeader/oppLeader are resolved relative to viewerPlayerId (the viewer on the
// personal library, the uploader on the team grid), independent of the canonical
// owner-first player ordering.
const replay = (over: any = {}) => ({
  slug: 'r_1', gameId: 'g1', userId: 'u-owner', ownerToken: 'kbx_x',
  ownerPlayerId: 'p1',
  players: [
    { id: 'p1', username: 'Alice', leader: { name: 'Greef Karga', set: 'JTL', number: 1 }, base: { name: 'Base A' } },
    { id: 'p2', username: 'Bob', leader: { name: 'Director Krennic', set: 'LOF', number: 2 }, base: { name: 'Base B' } },
  ],
  durationMs: 1000, actionCount: 10, winners: ['p1'], labels: null, displayName: null,
  match: { lobbyId: 'lob-123', gameFormat: 'premier', gamesToWinMode: 'bestOfThree' },
  createdAt: new Date('2026-06-08T19:00:00Z'),
  ...over,
});

describe('serializeReplayRow', () => {
  it('resolves ownLeader/oppLeader from the viewer perspective (owner side)', () => {
    const row = serializeReplayRow(replay(), { ownerName: 'Alice', viewerPlayerId: 'p1' });
    expect(row.ownLeader?.name).toBe('Greef Karga');
    expect(row.oppLeader?.name).toBe('Director Krennic');
    expect(row.viewerPlayerId).toBe('p1');
  });

  it('flips own/opp when the viewer is the OTHER player (alt-recorded double-sided)', () => {
    // I recorded as p2 (the alt); the canonical owner is still p1.
    const row = serializeReplayRow(replay(), { ownerName: 'Alice', viewerPlayerId: 'p2' });
    expect(row.ownLeader?.name).toBe('Director Krennic'); // my side
    expect(row.oppLeader?.name).toBe('Greef Karga');
    // ordering stays canonical owner-first (p1) regardless of perspective.
    expect(row.players[0].id).toBe('p1');
  });

  it('leaves leaders null when perspective is unknown', () => {
    const row = serializeReplayRow(replay(), { ownerName: null, viewerPlayerId: null });
    expect(row.ownLeader).toBeNull();
    expect(row.oppLeader).toBeNull();
  });

  it('carries lobbyId for grouping; null when match/lobby is absent', () => {
    expect(serializeReplayRow(replay(), { ownerName: 'A', viewerPlayerId: 'p1' }).lobbyId).toBe('lob-123');
    expect(serializeReplayRow(replay({ match: null }), { ownerName: 'A', viewerPlayerId: 'p1' }).lobbyId).toBeNull();
    expect(serializeReplayRow(replay({ match: { gameFormat: 'premier' } }), { ownerName: 'A', viewerPlayerId: 'p1' }).lobbyId).toBeNull();
  });

  it('ISO-stringifies createdAt and only includes extras when supplied', () => {
    const bare = serializeReplayRow(replay(), { ownerName: 'A', viewerPlayerId: 'p1' });
    expect(typeof bare.createdAt).toBe('string');
    expect('sharedTeams' in bare).toBe(false);
    expect('internal' in bare).toBe(false);
    const full = serializeReplayRow(replay(), { ownerName: 'A', viewerPlayerId: 'p1', sharedTeams: [{ slug: 't', name: 'T' }], internal: true, isMine: true, commentCount: 3 });
    expect(full.sharedTeams).toHaveLength(1);
    expect(full.internal).toBe(true);
    expect(full.commentCount).toBe(3);
  });
});
