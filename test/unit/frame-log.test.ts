import { describe, expect, it } from 'vitest';
import { extractAttacks, extractInteractions, extractFrameCards, boardAttacks, exhaustBaseAttacks } from '@/app/(app)/r/[slug]/frameLog';

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

describe('boardAttacks', () => {
  const fc = (zone: string, extra: any = {}) => ({ zone, ctrl: 'P1', ...extra });

  it('returns nothing when no unit is flagged isAttacker', () => {
    const cards = new Map<string, any>([['u1', fc('groundArena')]]);
    expect(boardAttacks(cards, new Map([['u1', 'groundArena']]))).toEqual([]);
  });

  it('targets the surviving isDefender unit', () => {
    const cards = new Map<string, any>([
      ['atk', fc('groundArena', { isAttacker: true })],
      ['def', fc('groundArena', { isDefender: true })],
    ]);
    const prevZones = new Map([['atk', 'groundArena'], ['def', 'groundArena']]);
    expect(boardAttacks(cards, prevZones)).toEqual([{ attackerUuid: 'atk', targetUuid: 'def' }]);
  });

  it('targets the lone unit that left the arena when no defender survives (recorder dropped the log)', () => {
    // the Rancor/Constable case: attacker survives, the defeated defender is now
    // in discard (still in `cards`), so the target = the one arena-exit.
    const cards = new Map<string, any>([
      ['rancor', fc('groundArena', { isAttacker: true })],
      ['constable', fc('discard')],
    ]);
    const prevZones = new Map([['rancor', 'groundArena'], ['constable', 'groundArena']]);
    expect(boardAttacks(cards, prevZones)).toEqual([{ attackerUuid: 'rancor', targetUuid: 'constable' }]);
  });

  it('skips when the target is ambiguous (a base attack: no defender, no arena exit)', () => {
    const cards = new Map<string, any>([['atk', fc('groundArena', { isAttacker: true })]]);
    expect(boardAttacks(cards, new Map([['atk', 'groundArena']]))).toEqual([]);
  });

  it('skips when multiple units exited (can\'t pin a single target)', () => {
    const cards = new Map<string, any>([
      ['atk', fc('groundArena', { isAttacker: true })],
      ['x', fc('discard')],
      ['y', fc('discard')],
    ]);
    const prevZones = new Map([['atk', 'groundArena'], ['x', 'groundArena'], ['y', 'groundArena']]);
    expect(boardAttacks(cards, prevZones)).toEqual([]);
  });

  it('B172: fires only on a NEW flag — a never-cleared flag does not re-lunge', () => {
    // Two leaders trade and both defeat (r_wrbj85): isAttacker/isDefender stick on
    // the defeated leaders in the `base` zone every later frame. The first frame
    // the flag appears is the attack; persistence after is not a new attack.
    const cards = new Map<string, any>([
      ['atk', fc('base', { isAttacker: true })],
      ['def', fc('base', { isDefender: true })],
    ]);
    const prevZones = new Map([['atk', 'base'], ['def', 'base']]);
    // flag newly set this frame → lunge once
    expect(boardAttacks(cards, prevZones, new Set())).toEqual([{ attackerUuid: 'atk', targetUuid: 'def' }]);
    // flag persisted from last frame → no re-lunge
    expect(boardAttacks(cards, prevZones, new Set(['atk']))).toEqual([]);
  });
});

describe('exhaustBaseAttacks', () => {
  // P1 owns base bP1; P2's unit `cmd` attacks it. State factory: per-unit
  // exhausted + per-base damage.
  const st = (cmdExhausted: boolean, baseDmg: number) => ({
    players: {
      P1: { user: { username: 'P1' }, base: { uuid: 'bP1', damage: baseDmg },
            cardPiles: { groundArena: [] } },
      P2: { user: { username: 'P2' },
            cardPiles: { groundArena: [{ uuid: 'cmd', controllerId: 'P2', zone: 'groundArena', exhausted: cmdExhausted }] } },
    },
  });

  it('attributes a dropped base attack to the unit that newly exhausted as the base took damage', () => {
    const prev = st(false, 10), cur = st(true, 14); // cmd exhausts + base +4, same frame
    expect(exhaustBaseAttacks(prev, cur, new Set())).toEqual([{ attackerUuid: 'cmd', targetUuid: 'bP1' }]);
  });

  it('stays silent when exhaust and damage are split across frames (a normally-logged attack)', () => {
    // declaration frame: cmd exhausts, no base damage yet
    expect(exhaustBaseAttacks(st(false, 10), st(true, 10), new Set())).toEqual([]);
    // resolution frame: base damaged, but cmd already exhausted (not newly)
    expect(exhaustBaseAttacks(st(true, 10), st(true, 14), new Set())).toEqual([]);
  });

  it('skips an attacker already lunging via log/flag (no double-lunge)', () => {
    expect(exhaustBaseAttacks(st(false, 10), st(true, 14), new Set(['cmd']))).toEqual([]);
  });

  it('never attributes a base attack to the base owner\'s own unit', () => {
    // P1's own unit exhausts as P1's base takes damage (e.g. an ability) — not an attack on itself
    const own = (ex: boolean, dmg: number) => ({
      players: { P1: { user: { username: 'P1' }, base: { uuid: 'bP1', damage: dmg },
        cardPiles: { groundArena: [{ uuid: 'u1', controllerId: 'P1', zone: 'groundArena', exhausted: ex }] } } },
    });
    expect(exhaustBaseAttacks(own(false, 10), own(true, 14), new Set())).toEqual([]);
  });

  it('skips when >1 enemy unit newly exhausted (ambiguous attacker)', () => {
    const multi = (ex: boolean, dmg: number) => ({
      players: {
        P1: { user: { username: 'P1' }, base: { uuid: 'bP1', damage: dmg }, cardPiles: { groundArena: [] } },
        P2: { cardPiles: { groundArena: [
          { uuid: 'a', controllerId: 'P2', zone: 'groundArena', exhausted: ex },
          { uuid: 'b', controllerId: 'P2', zone: 'groundArena', exhausted: ex },
        ] } },
      },
    });
    expect(exhaustBaseAttacks(multi(false, 10), multi(true, 14), new Set())).toEqual([]);
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
