import { describe, it, expect } from 'vitest';
import {
  planCollapse,
  collapseReplay,
  positionKey,
  relaxedPositionKey,
  isUndoMessage,
  type DecodedReplay,
} from '@/lib/replayDecoder';

// B154: robust undo detection. The strict positionKey ({players, phase})
// catches exact rewinds; ~30% of real undos land on a board that differs ONLY
// by transient per-card flags, so they slip through. We add (a) a relaxed key
// that ignores those flags, and (b) the karabast "has rolled back to" game-log
// alert as the authoritative undo trigger, used to locate the rollback target
// via the relaxed key. These pin the pure core.

// ---- helpers -------------------------------------------------------------

const rollbackMsg = (player = 'Alice', tail = 'their previous action') => ({
  message: { alert: { type: 'notification', message: [player, ' has rolled back to ', tail] } },
});
const requestMsg = (player = 'Alice') => ({
  message: { alert: { type: 'notification', message: [player, ' has requested to undo'] } },
});
const playMsg = (text = 'Alice plays Vader') => ({ message: [text] });

describe('isUndoMessage', () => {
  it('is true for every completed-rollback variant', () => {
    expect(isUndoMessage([rollbackMsg('Alice', 'their current action')])).toBe(true);
    expect(isUndoMessage([rollbackMsg('Alice', 'their previous action')])).toBe(true);
    expect(isUndoMessage([rollbackMsg('Bob', 'the start of the action phase (round 3)')])).toBe(true);
    expect(isUndoMessage([rollbackMsg('Bob', 'the start of the regroup phase (round 5)')])).toBe(true);
    expect(isUndoMessage([rollbackMsg('Bob', 'a previous bookmark')])).toBe(true);
  });
  it('is false for a mere undo REQUEST (may be denied)', () => {
    expect(isUndoMessage([requestMsg('Alice')])).toBe(false);
  });
  it('is false for ordinary log lines / empty', () => {
    expect(isUndoMessage([playMsg()])).toBe(false);
    expect(isUndoMessage([])).toBe(false);
    expect(isUndoMessage(undefined as any)).toBe(false);
  });
});

describe('relaxedPositionKey', () => {
  const withFlags = (flags: any) => ({
    phase: 'action',
    players: { p1: { leader: { uuid: 'L', zone: 'groundArena', ...flags } } },
  });
  it('ignores transient UI/combat flags', () => {
    const a = withFlags({ selected: true, isAttacker: true, sentinel: true });
    const b = withFlags({ selected: false, unselectable: true, isDefender: true, cannotBeAttacked: true });
    expect(relaxedPositionKey(a)).toBe(relaxedPositionKey(b));
    // strict key still sees the difference
    expect(positionKey(a)).not.toBe(positionKey(b));
  });
  it('ignores top-level isActionPhaseActivePlayer', () => {
    const a = { phase: 'action', players: { p1: { isActionPhaseActivePlayer: true, leader: { zone: 'base' } } } };
    const b = { phase: 'action', players: { p1: { isActionPhaseActivePlayer: false, leader: { zone: 'base' } } } };
    expect(relaxedPositionKey(a)).toBe(relaxedPositionKey(b));
  });
  it('still distinguishes a real board change', () => {
    const a = withFlags({});
    const b = { phase: 'action', players: { p1: { leader: { uuid: 'L', zone: 'base' } } } };
    expect(relaxedPositionKey(a)).not.toBe(relaxedPositionKey(b));
  });
  it('treats a 0/false/null default as equal to an omitted field', () => {
    // karabast serializes leader damage as 0 in one frame, omits it in another —
    // same board. (This was the one real-data undo the strict+flag key missed.)
    const zero = { phase: 'action', players: { p1: { leader: { uuid: 'L', zone: 'groundArena', damage: 0 } } } };
    const absent = { phase: 'action', players: { p1: { leader: { uuid: 'L', zone: 'groundArena' } } } };
    expect(relaxedPositionKey(zero)).toBe(relaxedPositionKey(absent));
    // but a real damage value stays distinct (don't over-merge 2 vs 0 damage)
    const dmg = { phase: 'action', players: { p1: { leader: { uuid: 'L', zone: 'groundArena', damage: 2 } } } };
    expect(relaxedPositionKey(dmg)).not.toBe(relaxedPositionKey(absent));
  });
});

describe('planCollapse — strict-undo regression (unchanged behavior)', () => {
  const noUndo = (n: number) => new Array(n).fill(false);
  it('truncates an exact rewind back to the origin', () => {
    const strict = ['A', 'B', 'C', 'A'];
    const { kept, frameRemap } = planCollapse(strict, strict, noUndo(4));
    expect(kept.map((k) => k.src)).toEqual([0]); // collapsed back to A
    expect(frameRemap).toEqual([0, 0, 0, 0]);
  });
  it('drops a board-static frame, keeping the position', () => {
    const strict = ['A', 'A', 'B'];
    const { kept, frameRemap } = planCollapse(strict, strict, noUndo(3));
    expect(kept.map((k) => k.src)).toEqual([0, 2]);
    expect(frameRemap).toEqual([0, 0, 1]);
  });
});

describe('planCollapse — log-driven relaxed undo (the ~30% gap)', () => {
  it('collapses an undo whose board differs only by transient flags', () => {
    // Frame 3 is the rollback of frame 0's position, but its strict key differs
    // (transient flags). Its relaxed key matches frame 0; the log marks it.
    const strict = ['A', 'B', 'C', 'A_flags'];
    const relaxed = ['ra', 'rb', 'rc', 'ra'];
    const isUndo = [false, false, false, true];
    const { kept, frameRemap } = planCollapse(strict, relaxed, isUndo);
    expect(kept.map((k) => k.src)).toEqual([0]);
    expect(frameRemap).toEqual([0, 0, 0, 0]);
  });
  it('does NOT collapse a denied undo request (no rollback alert)', () => {
    const strict = ['A', 'B', 'C', 'D'];
    const relaxed = ['ra', 'rb', 'rc', 'rd'];
    const isUndo = [false, false, false, false]; // "requested to undo" → not an undo
    const { kept } = planCollapse(strict, relaxed, isUndo);
    expect(kept.map((k) => k.src)).toEqual([0, 1, 2, 3]);
  });
  it('does NOT loosen board-static: a non-undo transient-flag change stays distinct', () => {
    // Adjacent frames whose relaxed keys match but which are NOT an undo must
    // remain two separate kept positions (only the undo branch uses relaxed).
    const strict = ['A', 'A_flags'];
    const relaxed = ['ra', 'ra'];
    const { kept } = planCollapse(strict, relaxed, [false, false]);
    expect(kept.map((k) => k.src)).toEqual([0, 1]);
  });
  it('handles nested log-driven undos resolving to different ancestors', () => {
    // A B C (undo→B) D (undo→A)
    const strict = ['A', 'B', 'C', 'B_f', 'D', 'A_f'];
    const relaxed = ['ra', 'rb', 'rc', 'rb', 'rd', 'ra'];
    const isUndo = [false, false, false, true, false, true];
    const { kept, frameRemap } = planCollapse(strict, relaxed, isUndo);
    expect(kept.map((k) => k.src)).toEqual([0]);
    expect(frameRemap[5]).toBe(0);
  });
});

describe('collapseReplay — derives the undo trigger from message deltas', () => {
  const f = (state: any) => ({ t: 0, state });
  // newMessages is CUMULATIVE; the rollback alert appears for the first time on
  // the undo frame and persists after, so detection must use the per-frame delta.
  const decoded = (frames: any[], msgs: any[][]): DecodedReplay => ({
    frames: frames.map(f),
    sideEvents: [],
    activeByFrame: frames.map(() => null),
    messagesByFrame: msgs,
    meta: { version: 2 },
    tags: [],
  });

  it('collapses a flag-only undo flagged purely by the cumulative log', () => {
    const A = { phase: 'action', players: { p1: { leader: { uuid: 'L', zone: 'base' } } } };
    const B = { phase: 'action', players: { p1: { leader: { uuid: 'L', zone: 'groundArena' } } } };
    // Frame 2 = rollback to A's position but with a transient flag set.
    const Aundo = { phase: 'action', players: { p1: { leader: { uuid: 'L', zone: 'base', selected: true } } } };
    const msgs = [
      [playMsg('start')],
      [playMsg('start'), playMsg('Alice deploys')],
      [playMsg('start'), playMsg('Alice deploys'), rollbackMsg('Alice')],
    ];
    const out = collapseReplay(decoded([A, B, Aundo], msgs));
    expect(out.frames.length).toBe(1); // B + the undo frame collapse away
    expect(out.frameRemap).toEqual([0, 0, 0]);
  });
});
