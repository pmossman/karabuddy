import { describe, expect, it } from 'vitest';
import { planFrameAnimations, type Snap, type Snapshot, type Intent, type PlanInput } from '@/app/(app)/r/[slug]/frameAnimationPlan';
import type { FrameCard } from '@/app/(app)/r/[slug]/frameLog';

const snap = (x: number, y: number, html = 'h', w = 10, h = 10): Snap => ({ x, y, w, h, html });
const snapshot = (entries: Record<string, Snap>): Snapshot => new Map(Object.entries(entries));

function plan(over: Partial<PlanInput>): Intent[] {
  return planFrameAnimations({
    prev: new Map(), next: new Map(), prevZones: new Map(),
    cards: new Map(), leaders: new Set(), attacks: [], interactions: [],
    ...over,
  });
}
const cardsOf = (m: Record<string, FrameCard>) => new Map(Object.entries(m));
const types = (is: Intent[]) => is.map((i) => i.type);

describe('planFrameAnimations', () => {
  it('emits a move for a real cross-zone position change', () => {
    const is = plan({
      prev: snapshot({ a: snap(0, 0) }), next: snapshot({ a: snap(100, 0) }),
      prevZones: new Map([['a', 'hand']]), cards: cardsOf({ a: { zone: 'groundArena', ctrl: 'p' } }),
    });
    expect(is).toEqual([{ type: 'move', uuid: 'a', from: snap(0, 0), to: snap(100, 0), delay: 0 }]);
  });

  it('SNAPS a same-zone tray reflow (hand re-centering) — no intent', () => {
    const is = plan({
      prev: snapshot({ a: snap(0, 0) }), next: snapshot({ a: snap(40, 0) }),
      prevZones: new Map([['a', 'hand']]), cards: cardsOf({ a: { zone: 'hand', ctrl: 'p' } }),
    });
    expect(is).toEqual([]);
  });

  it('ANIMATES a same-zone ARENA reflow (survivor sliding into a slot)', () => {
    const is = plan({
      prev: snapshot({ a: snap(0, 0) }), next: snapshot({ a: snap(40, 0) }),
      prevZones: new Map([['a', 'groundArena']]), cards: cardsOf({ a: { zone: 'groundArena', ctrl: 'p' } }),
    });
    expect(types(is)).toEqual(['move']);
  });

  it('ignores a sub-threshold jitter', () => {
    const is = plan({
      prev: snapshot({ a: snap(0, 0) }), next: snapshot({ a: snap(4, 0) }),
      prevZones: new Map([['a', 'groundArena']]), cards: cardsOf({ a: { zone: 'groundArena', ctrl: 'p' } }),
    });
    expect(is).toEqual([]);
  });

  it('enters a new card and exits a vanished one', () => {
    const is = plan({
      prev: snapshot({ gone: snap(0, 0) }), next: snapshot({ fresh: snap(0, 0) }),
      cards: cardsOf({ fresh: { zone: 'hand', ctrl: 'p' } }),
    });
    expect(is).toEqual([
      { type: 'enter', uuid: 'fresh', delay: 0 },
      { type: 'exit', uuid: 'gone', rect: snap(0, 0), delay: 0 },
    ]);
  });

  it('lunges the attacker (skipping its move) + holds the target look', () => {
    const is = plan({
      prev: snapshot({ atk: snap(0, 0), tgt: snap(50, 0, 'T1') }),
      next: snapshot({ atk: snap(0, 0), tgt: snap(50, 0, 'T2') }),
      prevZones: new Map([['atk', 'groundArena'], ['tgt', 'groundArena']]),
      cards: cardsOf({ atk: { zone: 'groundArena', ctrl: 'p' }, tgt: { zone: 'groundArena', ctrl: 'o' } }),
      attacks: [{ attackerUuid: 'atk', targetUuid: 'tgt' }],
    });
    expect(types(is)).toEqual(['lunge', 'targetHold']);
    expect(is[0]).toMatchObject({ type: 'lunge', uuid: 'atk' });
    expect(is[1]).toMatchObject({ type: 'targetHold', uuid: 'tgt' });
  });

  it('flips a leader that crosses the deploy boundary (arena ↔ slot)', () => {
    const is = plan({
      prev: snapshot({ L: snap(0, 0) }), next: snapshot({ L: snap(200, 200) }),
      prevZones: new Map([['L', 'base']]), cards: cardsOf({ L: { zone: 'groundArena', ctrl: 'p' } }),
      leaders: new Set(['L']),
    });
    expect(is).toEqual([{ type: 'leaderFlip', uuid: 'L', from: snap(0, 0), to: snap(200, 200), delay: 0 }]);
  });

  it('does NOT flip a leader reflowing within the arena — plain slide', () => {
    const is = plan({
      prev: snapshot({ L: snap(0, 0) }), next: snapshot({ L: snap(40, 0) }),
      prevZones: new Map([['L', 'groundArena']]), cards: cardsOf({ L: { zone: 'groundArena', ctrl: 'p' } }),
      leaders: new Set(['L']),
    });
    expect(types(is)).toEqual(['move']);
  });

  it('interaction → tracer (source placeable, far enough) + flash', () => {
    const is = plan({
      prev: snapshot({ src: snap(0, 0), tgt: snap(100, 0) }),
      next: snapshot({ src: snap(0, 0), tgt: snap(100, 0) }),
      prevZones: new Map([['src', 'groundArena'], ['tgt', 'groundArena']]),
      cards: cardsOf({ src: { zone: 'groundArena', ctrl: 'p' }, tgt: { zone: 'groundArena', ctrl: 'o' } }),
      interactions: [{ sourceUuid: 'src', targetUuid: 'tgt', kind: 'damage', baseUuid: null }],
    });
    expect(types(is)).toEqual(['tracer', 'flash']);
    expect(is[1]).toMatchObject({ type: 'flash', color: '#ff5a4d' });
  });

  it('interaction with an unplaceable source → flash only (no tracer)', () => {
    const is = plan({
      prev: snapshot({ tgt: snap(100, 0) }), next: snapshot({ tgt: snap(100, 0) }),
      cards: cardsOf({ tgt: { zone: 'groundArena', ctrl: 'o' } }),
      interactions: [{ sourceUuid: 'event', targetUuid: 'tgt', kind: 'heal', baseUuid: null }],
    });
    expect(types(is)).toEqual(['flash']);
    expect(is[0]).toMatchObject({ color: '#46d27a' });
  });

  it('falls the tracer back to the casters base when the source is gone', () => {
    const is = plan({
      prev: snapshot({ tgt: snap(100, 0), base: snap(0, 200) }), next: snapshot({ tgt: snap(100, 0), base: snap(0, 200) }),
      prevZones: new Map([['tgt', 'groundArena'], ['base', 'base']]),
      cards: cardsOf({ tgt: { zone: 'groundArena', ctrl: 'o' }, base: { zone: 'base', ctrl: 'p' } }),
      interactions: [{ sourceUuid: 'event', targetUuid: 'tgt', kind: 'damage', baseUuid: 'base' }],
    });
    expect(types(is)).toEqual(['tracer', 'flash']);
  });

  it('skips a self-target interaction entirely', () => {
    const is = plan({
      prev: snapshot({ x: snap(0, 0) }), next: snapshot({ x: snap(0, 0) }),
      cards: cardsOf({ x: { zone: 'groundArena', ctrl: 'p' } }),
      interactions: [{ sourceUuid: 'x', targetUuid: 'x', kind: 'heal', baseUuid: null }],
    });
    expect(is).toEqual([]);
  });

  it('pairs a hidden-hand play into a single playFlip (no stray enter/exit)', () => {
    const is = plan({
      prev: snapshot({ 'replay-hidden-p1-0': snap(0, 0) }),
      next: snapshot({ played: snap(100, 0) }),
      cards: cardsOf({ played: { zone: 'groundArena', ctrl: 'p1' } }),
    });
    expect(is).toEqual([{ type: 'playFlip', uuid: 'played', from: snap(0, 0), to: snap(100, 0) }]);
  });

  it('does NOT exit a defeated attacker — its lunge owns the visual', () => {
    const is = plan({
      prev: snapshot({ atk: snap(0, 0), tgt: snap(50, 0, 'T1') }),
      next: snapshot({ tgt: snap(50, 0, 'T2') }), // atk traded away (gone), tgt survives
      cards: cardsOf({ tgt: { zone: 'groundArena', ctrl: 'o' } }),
      attacks: [{ attackerUuid: 'atk', targetUuid: 'tgt' }],
    });
    expect(is.some((i) => i.type === 'exit')).toBe(false);
    expect(is.some((i) => i.type === 'lunge' && (i as any).uuid === 'atk')).toBe(true);
  });

  it('holds NOTHING at a stale position on an fx frame — every delay is 0', () => {
    // The whole ghost-clone class is "a delayed clone parked frozen at an old
    // slot." On an fx frame nothing is held: corpse, survivor, and lunge all run
    // from t=0 and cross-dissolve. Any non-zero delay here would reopen the class.
    const is = plan({
      prev: snapshot({ mover: snap(0, 0), dead: snap(50, 0) }),
      next: snapshot({ mover: snap(80, 0) }),
      prevZones: new Map([['mover', 'groundArena'], ['dead', 'groundArena']]),
      cards: cardsOf({ mover: { zone: 'groundArena', ctrl: 'p' } }),
      attacks: [{ attackerUuid: 'mover', targetUuid: 'dead' }],
    });
    const exit = is.find((i) => i.type === 'exit');
    expect(exit).toMatchObject({ type: 'exit', delay: 0 });
    expect(is.some((i) => i.type === 'lunge')).toBe(true);
  });

  it('HOLDS the board on an interaction-only frame so the bolt lands before death/reflow', () => {
    // No lunge body in the frame → the parked clones collide with nothing, so the
    // hold is ghost-safe and the bolt gets time to connect. corpse delayed,
    // survivor delayed further (fills in after the corpse clears).
    const is = plan({
      prev: snapshot({ src: snap(0, 0), tgt: snap(100, 0), survivor: snap(140, 0) }),
      next: snapshot({ src: snap(0, 0), survivor: snap(100, 0) }), // tgt defeated, survivor slides into its slot
      prevZones: new Map([['src', 'groundArena'], ['tgt', 'groundArena'], ['survivor', 'groundArena']]),
      cards: cardsOf({ src: { zone: 'groundArena', ctrl: 'p' }, survivor: { zone: 'groundArena', ctrl: 'p' } }),
      interactions: [{ sourceUuid: 'src', targetUuid: 'tgt', kind: 'damage', baseUuid: null }],
    });
    expect(is.find((i) => i.type === 'exit')).toMatchObject({ type: 'exit', uuid: 'tgt', delay: 300 });
    expect(is.find((i) => i.type === 'move')).toMatchObject({ type: 'move', uuid: 'survivor', delay: 540 });
  });

  it('cross-dissolves (delay 0) when an attack is also present, even with an interaction', () => {
    // A lunge would collide with any held clone → an attack in the frame forces
    // the no-hold path regardless of an interaction.
    const is = plan({
      prev: snapshot({ atk: snap(0, 0), tgt: snap(100, 0), survivor: snap(140, 0) }),
      next: snapshot({ atk: snap(0, 0), survivor: snap(100, 0) }),
      prevZones: new Map([['atk', 'groundArena'], ['tgt', 'groundArena'], ['survivor', 'groundArena']]),
      cards: cardsOf({ atk: { zone: 'groundArena', ctrl: 'p' }, survivor: { zone: 'groundArena', ctrl: 'p' } }),
      attacks: [{ attackerUuid: 'atk', targetUuid: 'tgt' }],
      interactions: [{ sourceUuid: 'atk', targetUuid: 'tgt', kind: 'damage', baseUuid: null }],
    });
    expect(is.find((i) => i.type === 'exit')).toMatchObject({ delay: 0 });
    expect(is.find((i) => i.type === 'move')).toMatchObject({ delay: 0 });
  });

  it('does NOT hold a survivor reflow OR a corpse on an fx frame (no frozen ghost on either side)', () => {
    // The two faces of the class: a survivor parked at its old slot under a lunge,
    // and a corpse held solid in the slot a survivor slides into. Both delays = 0.
    const is = plan({
      prev: snapshot({ atk: snap(0, 0), survivor: snap(100, 0), dead: snap(50, 0) }),
      next: snapshot({ atk: snap(0, 0), survivor: snap(50, 0) }), // survivor slides into the dead slot
      prevZones: new Map([['atk', 'groundArena'], ['survivor', 'groundArena'], ['dead', 'groundArena']]),
      cards: cardsOf({ atk: { zone: 'groundArena', ctrl: 'p' }, survivor: { zone: 'groundArena', ctrl: 'o' } }),
      attacks: [{ attackerUuid: 'atk', targetUuid: 'dead' }],
    });
    expect(is.find((i) => i.type === 'move')).toMatchObject({ type: 'move', uuid: 'survivor', delay: 0 });
    expect(is.find((i) => i.type === 'exit')).toMatchObject({ type: 'exit', uuid: 'dead', delay: 0 });
  });
});
