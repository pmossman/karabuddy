import { describe, expect, it } from 'vitest';
import { anonLabel, anonByIdFromPlayers, anonymizePlayersSummary, anonymizeFrames, anonymizeDecks } from '@/lib/anonymizeReplay';

describe('anonymizeReplay', () => {
  const players = [
    { id: 'p1', username: 'HoughHoney20', leader: { name: 'Luke' } },
    { id: 'p2', username: 'ReprintConfiscate', leader: { name: 'Vader' } },
  ];

  it('labels by order and maps ids', () => {
    expect(anonLabel(0)).toBe('Player1');
    const byId = anonByIdFromPlayers(players);
    expect(byId.get('p1')).toBe('Player1');
    expect(byId.get('p2')).toBe('Player2');
  });

  it('swaps usernames but keeps the rest of the player summary', () => {
    const anon = anonymizePlayersSummary(players);
    expect(anon.map((p) => p.username)).toEqual(['Player1', 'Player2']);
    expect(anon[0].leader).toEqual({ name: 'Luke' }); // decks preserved
  });

  it('rewrites board usernames + player log parts in the frames', () => {
    const byId = anonByIdFromPlayers(players);
    const frames = [
      {
        state: {
          players: {
            p1: { user: { username: 'HoughHoney20' } },
            p2: { user: { username: 'ReprintConfiscate' } },
          },
          newMessages: [
            { message: [{ type: 'player', id: 'p1', name: 'HoughHoney20' }, ' plays ', { type: 'card', name: 'X-Wing' }] },
          ],
        },
      },
    ];
    anonymizeFrames(frames, byId);
    expect(frames[0].state.players.p1.user.username).toBe('Player1');
    expect(frames[0].state.players.p2.user.username).toBe('Player2');
    const parts = frames[0].state.newMessages[0].message;
    expect(parts[0].name).toBe('Player1'); // player part renamed
    expect(parts[2].name).toBe('X-Wing');   // card part untouched
  });

  it('anonymizes decks: username → label, drops the deck title, keeps the cards', () => {
    const byId = anonByIdFromPlayers(players);
    const decks = {
      p1: { username: 'HoughHoney20', name: "Parker's Thrawn", deck: [{ id: 'SOR_001', count: 3 }] },
      p2: { username: 'ReprintConfiscate', name: 'spicy ramp', deck: null },
    };
    const anon = anonymizeDecks(decks, byId)!;
    expect(anon.p1.username).toBe('Player1');
    expect(anon.p1.name).toBeNull();
    expect(anon.p1.deck).toEqual([{ id: 'SOR_001', count: 3 }]); // decklist preserved
    expect(anon.p2.username).toBe('Player2');
    expect(anon.p2.name).toBeNull();
    expect(anonymizeDecks(null, byId)).toBeNull();
  });

  it('tolerates missing/odd shapes', () => {
    expect(() => anonymizeFrames(null, new Map())).not.toThrow();
    expect(() => anonymizeFrames([{ state: {} }], new Map([['p1', 'Player1']]))).not.toThrow();
    expect(anonymizePlayersSummary(null)).toEqual([]);
  });
});
