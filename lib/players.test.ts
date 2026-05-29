import { describe, expect, it } from 'vitest';
import { orderPlayersOwnerFirst } from './players';

describe('orderPlayersOwnerFirst', () => {
  it('promotes the owner to the front when listed second', () => {
    const players = [{ id: 'opp', name: 'Other' }, { id: 'me', name: 'Owner' }];
    expect(orderPlayersOwnerFirst(players, 'me')).toEqual([
      { id: 'me', name: 'Owner' },
      { id: 'opp', name: 'Other' },
    ]);
  });

  it('leaves order alone when the owner is already first', () => {
    const players = [{ id: 'me' }, { id: 'opp' }];
    const out = orderPlayersOwnerFirst(players, 'me');
    expect(out).toBe(players);
  });

  it('returns the input unchanged when ownerPlayerId is null', () => {
    const players = [{ id: 'a' }, { id: 'b' }];
    expect(orderPlayersOwnerFirst(players, null)).toBe(players);
  });

  it('returns [] for non-array input', () => {
    expect(orderPlayersOwnerFirst(null, 'me')).toEqual([]);
    expect(orderPlayersOwnerFirst(undefined, 'me')).toEqual([]);
    expect(orderPlayersOwnerFirst({} as any, 'me')).toEqual([]);
  });

  it('returns input unchanged when ownerPlayerId not found', () => {
    const players = [{ id: 'a' }, { id: 'b' }];
    expect(orderPlayersOwnerFirst(players, 'missing')).toBe(players);
  });
});
