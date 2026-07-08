import { describe, it, expect } from 'vitest';
import { buildNamedCardMap, stampNamedCards } from '@/lib/namedCards';

// A real Ryder Azadi naming message (structured game-log entry).
const ryderMsg = {
  date: '2026-06-07T08:07:07Z',
  message: [
    { id: 'p', name: 'ReprintConfiscate', uuid: 'Player_3', type: 'player' },
    ' names Imperial Armored Commando using ',
    { id: '2346080263', name: 'Ryder Azadi', uuid: 'Card_40', setId: { set: 'ASH', number: 77 }, type: 'card' },
  ],
};

describe('buildNamedCardMap', () => {
  it('maps the NAMING card uuid → the named card, from the log', () => {
    const map = buildNamedCardMap([[], [ryderMsg], []]);
    expect(map).toEqual({ Card_40: 'Imperial Armored Commando' });
  });

  it('tolerates raw-array messages + "name" singular', () => {
    const arr = [{ uuid: 'P' }, ' name Boba Fett using ', { uuid: 'Card_9' }];
    expect(buildNamedCardMap([[arr]])).toEqual({ Card_9: 'Boba Fett' });
  });

  it('ignores messages without a naming pattern or a card to attach', () => {
    expect(buildNamedCardMap([[{ message: [{ uuid: 'p' }, ' plays ', { uuid: 'c' }] }]])).toEqual({});
    expect(buildNamedCardMap([[{ message: [' names X using ' /* no card follows */] }]])).toEqual({});
    expect(buildNamedCardMap(null)).toEqual({});
  });

  it('last naming wins for a re-named uuid', () => {
    const first = { message: [{ uuid: 'p' }, ' names A using ', { uuid: 'C' }] };
    const second = { message: [{ uuid: 'p' }, ' names B using ', { uuid: 'C' }] };
    expect(buildNamedCardMap([[first], [second]])).toEqual({ C: 'B' });
  });
});

describe('stampNamedCards', () => {
  it('stamps namedCard onto board cards by uuid, in place', () => {
    const state = {
      players: {
        p1: { cardPiles: { groundArena: [{ uuid: 'Card_40', name: 'Ryder Azadi' }, { uuid: 'other' }] } },
        p2: { cardPiles: { spaceArena: [{ uuid: 'Card_99' }] } },
      },
    };
    stampNamedCards(state, { Card_40: 'Imperial Armored Commando' });
    expect(state.players.p1.cardPiles.groundArena[0].namedCard).toBe('Imperial Armored Commando');
    expect((state.players.p1.cardPiles.groundArena[1] as any).namedCard).toBeUndefined();
    expect((state.players.p2.cardPiles.spaceArena[0] as any).namedCard).toBeUndefined();
  });

  it('no-ops on empty map / no players', () => {
    expect(() => stampNamedCards({}, {})).not.toThrow();
    expect(() => stampNamedCards(null, { a: 'b' })).not.toThrow();
  });
});
