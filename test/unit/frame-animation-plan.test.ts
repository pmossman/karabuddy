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

  it('B134: a leader DEPLOY (slot → arena) gets the dramatic raise-flip-slam', () => {
    const is = plan({
      prev: snapshot({ L: snap(0, 0) }), next: snapshot({ L: snap(200, 200) }),
      prevZones: new Map([['L', 'base']]), cards: cardsOf({ L: { zone: 'groundArena', ctrl: 'p' } }),
      leaders: new Set(['L']),
    });
    expect(is.length).toBe(1);
    expect(is[0]).toMatchObject({ type: 'leaderDeploy', uuid: 'L', from: snap(0, 0), to: snap(200, 200) });
  });

  it('a leader RETURN (arena → slot) keeps the quick crossfade', () => {
    const is = plan({
      prev: snapshot({ L: snap(200, 200) }), next: snapshot({ L: snap(0, 0) }),
      prevZones: new Map([['L', 'groundArena']]), cards: cardsOf({ L: { zone: 'base', ctrl: 'p' } }),
      leaders: new Set(['L']),
    });
    expect(is).toEqual([{ type: 'leaderFlip', uuid: 'L', from: snap(200, 200), to: snap(0, 0), delay: 0 }]);
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

  // B134: staged event/upgrade plays.
  it('stages an own-hand EVENT play (hand → discard) and skips its move/exit', () => {
    const is = plan({
      prev: snapshot({ ev: snap(0, 0) }),
      next: snapshot({ ev: snap(200, 50) }), // discard render
      prevZones: new Map([['ev', 'hand']]),
      cards: cardsOf({ ev: { zone: 'discard', ctrl: 'p1' } }),
      eventPlays: [{ uuid: 'ev' }],
    });
    // No bases → stage = midpoint of the from/discard centers.
    expect(is).toEqual([
      { type: 'eventStage', uuid: 'ev', from: snap(0, 0), to: snap(200, 50), faceDown: false, stage: { x: 105, y: 30 } },
    ]);
  });

  it('stages an own-hand UPGRADE play under its unit (no stray move/exit)', () => {
    const is = plan({
      // The unit pre-exists on the board (prev + next, same slot); only the
      // upgrade card leaves the hand. The upgrade has no own rect (renders as
      // a strip), so it never appears in the measured snapshots.
      prev: snapshot({ up: snap(0, 0), unit: snap(100, 100, 'U', 20, 28) }),
      next: snapshot({ unit: snap(100, 100, 'U', 20, 28) }),
      prevZones: new Map([['up', 'hand'], ['unit', 'groundArena']]),
      cards: cardsOf({
        up: { zone: 'groundArena', ctrl: 'p1', parentCardId: 'unit', setId: { set: 'ASH', number: 66 } },
        unit: { zone: 'groundArena', ctrl: 'p1' },
      }),
      eventPlays: [{ uuid: 'up' }],
    });
    expect(types(is)).toEqual(['upgradeStage']);
    const u = is[0] as Extract<Intent, { type: 'upgradeStage' }>;
    expect(u.uuid).toBe('up');
    expect(u.unit).toEqual(snap(100, 100, 'U', 20, 28));
    expect(u.faceDown).toBe(false);
    expect(u.faceUp).toBeNull(); // own hand — no flip face needed
    // Presented above the unit center.
    expect(u.stage.x).toBe(110);
    expect(u.stage.y).toBeCloseTo(114 - 28 * 0.7);
  });

  it('B134: resourcing — cards committed hand→resource grow + flip into the pile', () => {
    const is = plan({
      prev: snapshot({ rA: snap(0, 0), rB: snap(20, 0) }), // hand cards
      next: snapshot({}),                                   // pile has no per-card uuid
      prevZones: new Map([['rA', 'hand'], ['rB', 'hand']]),
      cards: cardsOf({ rA: { zone: 'resource', ctrl: 'me' }, rB: { zone: 'resource', ctrl: 'me' } }),
      resourcePile: snap(300, 200, 'pile', 12, 16),
    });
    const stages = is.filter((i) => i.type === 'resourceStage') as Extract<Intent, { type: 'resourceStage' }>[];
    expect(stages.length).toBe(2);
    expect(stages.every((s) => s.pile.x === 300)).toBe(true);
    // Presented SIDE BY SIDE: same stage height, distinct x.
    expect(stages[0].stage.y).toBe(stages[1].stage.y);
    expect(stages[0].stage.x).not.toBe(stages[1].stage.x);
    expect(stages.every((s) => s.faceDown === false)).toBe(true); // own → visible
    // The committed cards must NOT also fade out via the exit loop.
    expect(is.some((i) => i.type === 'exit')).toBe(false);
  });

  it('B134: the opponent resources FACE DOWN (hidden hand → opp pile), no stray exit', () => {
    const is = plan({
      // The opponent's hidden hand: two replay-hidden cards leave it this frame.
      prev: snapshot({ 'replay-hidden-opp-0': snap(0, 0), 'replay-hidden-opp-1': snap(20, 0) }),
      next: snapshot({}), // anonymous pile cards have no uuid
      prevZones: new Map([['replay-hidden-opp-0', 'hand'], ['replay-hidden-opp-1', 'hand']]),
      cards: cardsOf({}),
      localPlayerId: 'me',
      resourceCounts: new Map([['opp', 2]]),
      resourcePileOpp: snap(300, 50, 'opp-pile', 12, 16),
    });
    const stages = is.filter((i) => i.type === 'resourceStage') as Extract<Intent, { type: 'resourceStage' }>[];
    expect(stages.length).toBe(2);
    expect(stages.every((s) => s.faceDown === true)).toBe(true); // hidden → cardback
    expect(stages.every((s) => s.pile.y === 50)).toBe(true);     // opp pile
    expect(is.some((i) => i.type === 'exit')).toBe(false);       // consumed, not faded
  });

  it('B134: a hands-up reveal sends the opponent’s VISIBLE resource to the opp pile face-up', () => {
    const is = plan({
      prev: snapshot({ oppCard: snap(0, 0) }),
      next: snapshot({}),
      prevZones: new Map([['oppCard', 'hand']]),
      cards: cardsOf({ oppCard: { zone: 'resource', ctrl: 'opp' } }),
      localPlayerId: 'me',
      resourcePile: snap(300, 600, 'my', 12, 16),
      resourcePileOpp: snap(300, 50, 'opp', 12, 16),
    });
    const stages = is.filter((i) => i.type === 'resourceStage') as Extract<Intent, { type: 'resourceStage' }>[];
    expect(stages.length).toBe(1);
    expect(stages[0].faceDown).toBe(false); // revealed → flips face-up→down like own
    expect(stages[0].pile.y).toBe(50);      // opponent's pile, not ours
  });

  it('without a measured resource pile, resourcing falls back (no resourceStage)', () => {
    const is = plan({
      prev: snapshot({ rA: snap(0, 0) }),
      next: snapshot({}),
      prevZones: new Map([['rA', 'hand']]),
      cards: cardsOf({ rA: { zone: 'resource', ctrl: 'me' } }),
      // resourcePile omitted → null
    });
    expect(is.some((i) => i.type === 'resourceStage')).toBe(false);
  });

  it('a staged EVENT delays its effect (defeated units to discard) until the card presents', () => {
    // Hyperspace Disaster plays (→ discard) AND defeats space units (they slide
    // to discard) in one frame. The defeats must wait for the card to present
    // above the board, not fire simultaneously.
    const is = plan({
      prev: snapshot({ ev: snap(0, 0), unitA: snap(50, 0), unitB: snap(70, 0) }),
      next: snapshot({ ev: snap(200, 50), unitA: snap(210, 50), unitB: snap(220, 50) }), // all in discard now
      prevZones: new Map([['ev', 'hand'], ['unitA', 'spaceArena'], ['unitB', 'spaceArena']]),
      cards: cardsOf({
        ev: { zone: 'discard', ctrl: 'p1' },
        unitA: { zone: 'discard', ctrl: 'p2' },
        unitB: { zone: 'discard', ctrl: 'p2' },
      }),
      eventPlays: [{ uuid: 'ev' }],
    });
    const moves = is.filter((i) => i.type === 'move') as Extract<Intent, { type: 'move' }>[];
    expect(moves.length).toBe(2); // the two defeated units
    expect(moves.every((m) => m.delay > 0)).toBe(true); // held until the card presents
    expect(is.some((i) => i.type === 'eventStage' && (i as any).uuid === 'ev')).toBe(true);
  });

  it('a hidden-hand UPGRADE play flips via card art + consumes the hidden exit', () => {
    const is = plan({
      prev: snapshot({ 'replay-hidden-p2-0': snap(0, 0), unit: snap(100, 100, 'U', 20, 28) }),
      next: snapshot({ unit: snap(100, 100, 'U', 20, 28) }),
      prevZones: new Map([['unit', 'groundArena']]),
      cards: cardsOf({
        up: { zone: 'groundArena', ctrl: 'p2', parentCardId: 'unit', setId: { set: 'LOF', number: 91 } },
        unit: { zone: 'groundArena', ctrl: 'p2' },
      }),
      eventPlays: [{ uuid: 'up' }],
    });
    expect(types(is)).toEqual(['upgradeStage']); // the hidden card is paired, not exited
    const u = is[0] as Extract<Intent, { type: 'upgradeStage' }>;
    expect(u.faceDown).toBe(true);
    expect(u.faceUp).toMatch(/LOF.*091/);
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

  it('B134: a unit created on an attack frame (Spy token) enters AFTER the strike', () => {
    // Dedra lunges; a Spy token is new this frame. The token must not fade in
    // during the lunge (it reads as a clone of the attacker) — delay its enter
    // until the strike lands.
    const is = plan({
      prev: snapshot({ dedra: snap(0, 0), obi: snap(90, 0) }),
      next: snapshot({ dedra: snap(0, 0), spy: snap(20, 0) }), // obi defeated, spy created
      prevZones: new Map([['dedra', 'groundArena'], ['obi', 'groundArena']]),
      cards: cardsOf({ dedra: { zone: 'groundArena', ctrl: 'p' }, spy: { zone: 'groundArena', ctrl: 'p' } }),
      attacks: [{ attackerUuid: 'dedra', targetUuid: 'obi' }],
    });
    const enter = is.find((i) => i.type === 'enter' && (i as any).uuid === 'spy') as Extract<Intent, { type: 'enter' }>;
    expect(enter).toBeTruthy();
    expect(enter.delay).toBeGreaterThan(0); // held until the strike, not during the lunge
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
