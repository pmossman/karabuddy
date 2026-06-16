import { describe, it, expect } from 'vitest';
import { planCollapse, positionKey, collapseReplay, type DecodedReplay } from './replayDecoder';

// B102: undo + board-static collapse. planCollapse is the pure core (operates
// on per-frame position keys); collapseReplay applies it to a decoded replay.

// B154: planCollapse now also takes relaxed keys + a per-frame undo flag. These
// strict-key cases drive undo via exact-position repetition (the relaxed key ==
// the strict key here, and no log-driven undo), so behavior is unchanged.
const pc = (keys: string[]) => planCollapse(keys, keys, keys.map(() => false));

describe('planCollapse', () => {
  it('keeps every frame when all positions are distinct', () => {
    const { kept, frameRemap } = pc(['A', 'B', 'C']);
    expect(kept.map((k) => k.src)).toEqual([0, 1, 2]);
    expect(frameRemap).toEqual([0, 1, 2]);
  });

  it('drops a board-static frame and carries its log to the next board frame', () => {
    // A, A(only-log-changed), B
    const { kept, frameRemap } = pc(['A', 'A', 'B']);
    expect(kept.map((k) => k.src)).toEqual([0, 2]);
    expect(frameRemap).toEqual([0, 0, 1]);
    // The static frame (1) + the next board frame (2) feed collapsed frame 1's log.
    expect(kept[1].msgSrcs).toEqual([1, 2]);
    expect(kept[0].msgSrcs).toEqual([0]);
  });

  it('truncates a simple undo branch back to the rewound position', () => {
    // A, B, C, (undo)->B, D
    const { kept, frameRemap } = pc(['A', 'B', 'C', 'B', 'D']);
    expect(kept.map((k) => k.src)).toEqual([0, 1, 4]);
    expect(frameRemap).toEqual([0, 1, 1, 1, 2]);
  });

  it('handles nested undos (rewind past an already-rewound point)', () => {
    // A, B, C, D, (undo)->C, (undo)->B, E. The second undo (to B) discards
    // everything from C onward, so C/D/re-C all collapse onto B.
    const { frameRemap } = pc(['A', 'B', 'C', 'D', 'C', 'B', 'E']);
    expect(frameRemap).toEqual([0, 1, 1, 1, 1, 1, 2]);
  });

  it('flushes trailing board-static log lines onto the last frame', () => {
    const { kept, frameRemap } = pc(['A', 'A']);
    expect(kept.map((k) => k.src)).toEqual([0]);
    expect(frameRemap).toEqual([0, 0]);
    expect(kept[0].msgSrcs).toEqual([0, 1]);
  });

  it('does not treat a board-static dup of the current frame as an undo', () => {
    // A, A is static (drop), not a rewind. B, B static. distinct A vs B.
    const { kept } = pc(['A', 'A', 'B', 'B']);
    expect(kept.map((k) => k.src)).toEqual([0, 2]);
  });
});

// --- collapseReplay over a synthetic decoded replay -------------------------

function frame(phase: string) {
  // positionKey hashes players + phase; vary phase to vary the position.
  return { t: 0, state: { players: {}, phase, newMessages: [] } };
}

function makeDecoded(phases: string[], messages: string[][], tags: any[] = [], sideEvents: any[] = []): DecodedReplay {
  return {
    frames: phases.map(frame),
    sideEvents,
    activeByFrame: phases.map(() => null),
    messagesByFrame: messages,
    meta: { version: 2 },
    tags,
  };
}

describe('collapseReplay', () => {
  it('merges carried log messages onto the surviving board frames', () => {
    const decoded = makeDecoded(
      ['A', 'A', 'B'],
      [['a0'], ['a1'], ['b0']],
    );
    const out = collapseReplay(decoded);
    expect(out.frames.length).toBe(2);
    // Frame 0 (A): just its own log. Frame 1 (B): carried static log + its own.
    expect(out.messagesByFrame).toEqual([['a0'], ['a1', 'b0']]);
    expect(out.frames[1].state.newMessages).toEqual(['a1', 'b0']);
    expect(out.frameRemap).toEqual([0, 0, 1]);
    expect(out.collapsedToOrig).toEqual([0, 2]);
  });

  it('drops undone frames and their log lines', () => {
    const decoded = makeDecoded(
      ['A', 'B', 'C', 'B', 'D'],
      [['a'], ['b'], ['c-undone'], ['undo-noise'], ['d']],
    );
    const out = collapseReplay(decoded);
    expect(out.frames.map((f) => f.state.phase)).toEqual(['A', 'B', 'D']);
    // The undone branch's log ('c-undone') and the undo landing's log
    // ('undo-noise') are gone.
    expect(out.messagesByFrame).toEqual([['a'], ['b'], ['d']]);
  });

  it('remaps tag and sideEvent frame indices into collapsed space', () => {
    const tags = [
      { id: 't-static', frameIndex: 1, author: 'x', comment: '', createdAt: 0 }, // on board-static A
      { id: 't-undone', frameIndex: 2, author: 'x', comment: '', createdAt: 0 }, // on undone C
      { id: 't-final', frameIndex: 5, author: 'x', comment: '', createdAt: 0 },  // on D
    ];
    const side = [{ t: 0, dir: 'in', event: 'message', args: [], frameIndex: 2 }];
    // A, A(static), B, C, (undo)->B, D  → collapsed A,B,D
    const decoded = makeDecoded(
      ['A', 'A', 'B', 'C', 'B', 'D'],
      [['a'], ['a2'], ['b'], ['c'], ['u'], ['d']],
      tags,
      side,
    );
    const out = collapseReplay(decoded);
    expect(out.frames.map((f) => f.state.phase)).toEqual(['A', 'B', 'D']);
    const byId = Object.fromEntries(out.tags.map((t: any) => [t.id, t.frameIndex]));
    expect(byId['t-static']).toBe(0); // static A → collapsed A
    expect(byId['t-undone']).toBe(1); // undone C → rewind landing B
    expect(byId['t-final']).toBe(2);  // D → collapsed D
    expect(out.sideEvents[0].frameIndex).toBe(1); // C → B
  });

  it('round-trips: a new tag stored at collapsedToOrig[c] remaps back to c', () => {
    const decoded = makeDecoded(['A', 'A', 'B', 'C', 'B', 'D'], [[], [], [], [], [], []]);
    const out = collapseReplay(decoded);
    out.collapsedToOrig.forEach((orig, c) => {
      expect(out.frameRemap[orig]).toBe(c);
    });
  });

  it('is a no-op on a replay with no repeats or static frames', () => {
    const decoded = makeDecoded(['A', 'B', 'C'], [['a'], ['b'], ['c']]);
    const out = collapseReplay(decoded);
    expect(out.frames.length).toBe(3);
    expect(out.frameRemap).toEqual([0, 1, 2]);
    expect(out.collapsedToOrig).toEqual([0, 1, 2]);
  });

  it('handles an empty replay', () => {
    const out = collapseReplay(makeDecoded([], []));
    expect(out.frames).toEqual([]);
    expect(out.frameRemap).toEqual([]);
    expect(out.collapsedToOrig).toEqual([]);
  });
});

describe('positionKey', () => {
  it('ignores newMessages (chat/log) but reflects board + phase', () => {
    const a = { players: { p1: { hand: [1] } }, phase: 'action', newMessages: ['x'] };
    const b = { players: { p1: { hand: [1] } }, phase: 'action', newMessages: ['y', 'z'] };
    const c = { players: { p1: { hand: [2] } }, phase: 'action', newMessages: ['x'] };
    expect(positionKey(a)).toBe(positionKey(b)); // only log differs → same position
    expect(positionKey(a)).not.toBe(positionKey(c)); // board differs
  });
});
