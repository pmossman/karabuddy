import { describe, it, expect } from 'vitest';
import { mergeSlices, sliceHasKeys } from '@/lib/replayMerge';
import { decodeReplay } from '@/lib/replayDecoder';

// B120: slice-and-merge stitches partial recordings of one game (split across
// karabast tabs) into a complete, monotonic timeline keyed by totalMessages.

// A gamestate frame whose `pos` == its merge key, so we can assert ordering.
const frame = (key: number, active: 'p1' | 'p2' = 'p1') => ({
  id: 'g', pos: key, phase: 'action',
  players: {
    p1: { isActionPhaseActivePlayer: active === 'p1' },
    p2: { isActionPhaseActivePlayer: active === 'p2' },
  },
});
// A slice payload: each key emitted as a {full} (valid; the merge reconstructs).
const slice = (keys: number[], opts: { tags?: any[]; durationMs?: number; match?: any; tag?: (k: number) => any } = {}) => ({
  version: 2, durationMs: opts.durationMs ?? 0, localPlayerId: 'p1', match: opts.match ?? null, decks: null,
  tags: opts.tags ?? [],
  events: keys.map((k) => ({ t: 0, dir: 'in', event: 'gamestate', key: k, args: [{ full: frame(k) }] })),
});
// Merged → the ordered list of `pos` values across reconstructed frames.
const mergedPositions = (merged: any): number[] =>
  decodeReplay(merged).frames.map((f: any) => f.state.pos);

describe('mergeSlices', () => {
  it('clean handoff: A then B → full union in order', () => {
    const m = mergeSlices([slice([0, 1, 2]), slice([3, 4, 5])]);
    expect(mergedPositions(m)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('overlap dedups by key', () => {
    const m = mergeSlices([slice([0, 1, 2, 3]), slice([2, 3, 4, 5])]);
    expect(mergedPositions(m)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('interleave (the flip-flop case) reorders by key', () => {
    const m = mergeSlices([slice([0, 2, 4]), slice([1, 3, 5])]);
    expect(mergedPositions(m)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('gap: non-contiguous slices merge monotonically without crashing', () => {
    const m = mergeSlices([slice([0, 1]), slice([4, 5])]);
    expect(mergedPositions(m)).toEqual([0, 1, 4, 5]);
  });

  it('is idempotent: re-merging a slice changes nothing', () => {
    const a = slice([0, 1, 2]);
    const once = mergeSlices([a, slice([2, 3])]);
    const twice = mergeSlices([once, a]);
    expect(mergedPositions(twice)).toEqual([0, 1, 2, 3]);
  });

  it('tie on the same key: last slice wins', () => {
    const a = { ...slice([2]), events: [{ t: 0, dir: 'in', event: 'gamestate', key: 2, args: [{ full: { ...frame(2), board: 'A' } }] }] };
    const b = { ...slice([2]), events: [{ t: 0, dir: 'in', event: 'gamestate', key: 2, args: [{ full: { ...frame(2), board: 'B' } }] }] };
    const m = mergeSlices([a, b]);
    expect(decodeReplay(m).frames[0].state.board).toBe('B');
  });

  it('B219: preserves + combines transport diagnostics across the merge', () => {
    const a = { ...slice([0, 1, 2]), diag: { wsOpen: 1, wsClose: 1, pollIn: 0, transport: 'websocket', lastGamestateAtMs: 100, events: [{ t: 10, type: 'ws-open' }] } };
    const b = { ...slice([3, 4]), diag: { wsOpen: 1, wsClose: 0, pollIn: 3, transport: 'polling', lastGamestateAtMs: 250, events: [{ t: 5, type: 'ws-close' }, { t: 20, type: 'poll-active' }] } };
    const m = mergeSlices([a, b]);
    expect(m.diag.wsClose).toBe(1);
    expect(m.diag.pollIn).toBe(3);
    expect(m.diag.transport).toBe('polling'); // latest non-null wins
    expect(m.diag.lastGamestateAtMs).toBe(250);
    expect(m.diag.events.map((e: any) => e.type)).toEqual(['ws-close', 'ws-open', 'poll-active']); // union, time-sorted
  });

  it('B219: dedups identical diag events (same-recorder flush + finalize slices)', () => {
    // A socket-close flush and the later finalize are snapshots of the SAME
    // recorder — both carry the same lifecycle events. They must not double.
    const ev = [{ t: 10, type: 'ws-open' }, { t: 90, type: 'ws-close', code: 1006 }];
    const a = { ...slice([0, 1]), diag: { wsOpen: 1, wsClose: 1, pollIn: 0, transport: 'websocket', lastGamestateAtMs: 80, events: ev } };
    const b = { ...slice([2, 3]), diag: { wsOpen: 1, wsClose: 1, pollIn: 2, transport: 'polling', lastGamestateAtMs: 200, events: [...ev, { t: 95, type: 'poll-active' }] } };
    const m = mergeSlices([a, b]);
    expect(m.diag.events.map((e: any) => e.type)).toEqual(['ws-open', 'ws-close', 'poll-active']);
  });

  it('B219: omits diag when no slice carried it (old extension)', () => {
    expect(mergeSlices([slice([0, 1]), slice([2, 3])]).diag).toBeUndefined();
  });

  it('remaps tag frameIndex by its stamped key', () => {
    // tag anchored at key 3 → after merge of [0,2,4,6] + [1,3,5], index of key 3 is 3.
    const a = slice([0, 2, 4, 6], { tags: [{ id: 't1', key: 3, frameIndex: 99, comment: 'x', author: 'A' }] });
    const b = slice([1, 3, 5]);
    const m = mergeSlices([a, b]);
    expect(m.tags.find((t: any) => t.id === 't1').frameIndex).toBe(3); // keys sorted: 0,1,2,3,...
  });

  it('returns null when any slice lacks keys (fallback signal)', () => {
    const keyed = slice([0, 1]);
    const unkeyed = { version: 2, events: [{ t: 0, dir: 'in', event: 'gamestate', args: [{ full: frame(0) }] }], tags: [] };
    expect(mergeSlices([keyed, unkeyed])).toBeNull();
  });

  it('takes the max durationMs and unions match metadata', () => {
    const m = mergeSlices([slice([0, 1], { durationMs: 100 }), slice([2, 3], { durationMs: 5000, match: { lobbyId: 'L' } })]);
    expect(m.durationMs).toBe(5000);
    expect(m.match).toEqual({ lobbyId: 'L' });
  });
});

describe('sliceHasKeys', () => {
  it('true only when every gamestate event has a numeric key', () => {
    expect(sliceHasKeys(slice([0, 1, 2]))).toBe(true);
    expect(sliceHasKeys({ version: 2, events: [{ event: 'gamestate', args: [{ full: frame(0) }] }] })).toBe(false);
    expect(sliceHasKeys({ version: 2, events: [] })).toBe(false); // no gamestates
  });
});
