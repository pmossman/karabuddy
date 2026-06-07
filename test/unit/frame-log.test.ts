import { describe, expect, it } from 'vitest';
import { extractAttacks, extractInteractions, extractFrameCards } from '@/app/(app)/r/[slug]/frameLog';

const player = (name: string) => ({ type: 'player', name });
const card = (name: string, uuid: string) => ({ type: 'card', name, uuid });
const msg = (...parts: any[]) => ({ message: parts });

describe('extractAttacks', () => {
  it('reads a unit attack: target = card after "attacks", attacker = card after "with"', () => {
    const state = { newMessages: [msg(player('P'), ' attacks ', card('Tgt', 't1'), ' with ', card('Atk', 'a1'))] };
    expect(extractAttacks(state)).toEqual([{ attackerUuid: 'a1', targetUuid: 't1' }]);
  });

  it('resolves a base attack to the opponent base', () => {
    const state = {
      newMessages: [msg(player('P'), ' attacks ', player('Opp'), "'s base with ", card('Atk', 'a1'))],
      players: {
        P1: { cardPiles: { groundArena: [{ uuid: 'a1', controllerId: 'P1' }] } },
        P2: { base: { uuid: 'b2' } },
      },
    };
    expect(extractAttacks(state)).toEqual([{ attackerUuid: 'a1', targetUuid: 'b2' }]);
  });
});

describe('extractInteractions', () => {
  const players = { P1: { user: { username: 'P' }, base: { uuid: 'bP' } } };

  it('classifies damage and resolves the caster base', () => {
    const state = { players, newMessages: [msg(player('P'), ' uses ', card('Src', 's1'), ' to deal 5 damage to ', card('Tgt', 't1'))] };
    expect(extractInteractions(state)).toEqual([{ sourceUuid: 's1', targetUuid: 't1', kind: 'damage', baseUuid: 'bP' }]);
  });

  it('classifies "to defeat" as damage and heal as heal', () => {
    const dmg = { players, newMessages: [msg(player('P'), ' plays ', card('Ev', 'e1'), ' to defeat ', card('Tgt', 't1'))] };
    const heal = { players, newMessages: [msg(player('P'), ' uses ', card('Src', 's1'), ' to heal 2 damage from ', card('Tgt', 't1'))] };
    expect(extractInteractions(dmg)[0].kind).toBe('damage');
    expect(extractInteractions(heal)[0].kind).toBe('heal');
  });

  it('skips combat, shield redirects, and self-targets', () => {
    const attack = { players, newMessages: [msg(player('P'), ' attacks ', card('T', 't1'), ' with ', card('A', 'a1'))] };
    const redirect = { players, newMessages: [msg(player('P'), ' uses ', card('Shield', 's1'), ' to defeat ', card('Shield', 's1'), ' instead of ', card('U', 'u1'), ' taking damage')] };
    const self = { players, newMessages: [msg(player('P'), ' uses ', card('Luke', 'l1'), ' to heal 1 damage from ', card('Luke', 'l1'))] };
    expect(extractInteractions(attack)).toEqual([]);
    expect(extractInteractions(redirect)).toEqual([]);
    expect(extractInteractions(self)).toEqual([]);
  });
});

describe('extractFrameCards', () => {
  it('maps zone + controller per card and includes each leader with its zone', () => {
    const state = {
      players: {
        P1: {
          cardPiles: { hand: [{ uuid: 'h1', controllerId: 'P1' }], groundArena: [{ uuid: 'g1', zone: 'groundArena', controllerId: 'P1' }] },
          leader: { uuid: 'L1', zone: 'base' },
        },
      },
    };
    const { cards, leaders } = extractFrameCards(state);
    expect(cards.get('h1')).toEqual({ zone: 'hand', ctrl: 'P1' });
    expect(cards.get('g1')).toEqual({ zone: 'groundArena', ctrl: 'P1' });
    expect(cards.get('L1')?.zone).toBe('base');
    expect(leaders.has('L1')).toBe(true);
  });
});
