// B120: slice-and-merge — stitch multiple partial recordings of the SAME game
// into one complete replay. karabast binds a user to one game socket; a second
// tab makes the server rebind + the tabs flip-flop, so the gamestate stream gets
// split/interleaved across two independent per-tab recorders. Each uploads its
// slice; without merging, the server's last-write-wins clobbers (a mid-game
// partial overwrites a complete-from-start recording).
//
// The merge key is the recorder's per-gamestate-event `key`, captured from
// karabast's `gamestate.totalMessages` — the global, monotonic, per-game count
// of game-log messages (forceteki Game.getState), identical across every socket
// at the same moment. So frames from different tabs that share a key are the
// same game moment; union by key, sort, and the timeline is monotonic by
// construction regardless of how the slices interleaved.
import { applyPatch, makePatch, reconstructFinalState, mergeDecks } from './replayDecoder';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Every gamestate event in this payload carries a numeric `key`? Only then can
// we key-merge. Old-extension payloads (no key) return false → caller falls back
// to last-write-wins. Returns false for a payload with no gamestate events.
export function sliceHasKeys(parsed: any): boolean {
  const events = parsed?.events;
  if (!Array.isArray(events)) return false;
  let sawGamestate = false;
  for (const e of events) {
    if (e?.event !== 'gamestate') continue;
    const arg = e?.args?.[0];
    if (!arg || (!arg.full && !arg.patch)) continue;
    sawGamestate = true;
    if (typeof e.key !== 'number') return false;
  }
  return sawGamestate;
}

// Reconstruct one payload's gamestate events into [{ key, state }] — absolute
// normalized full states paired with their merge key. (Stored states are
// already normalized by the recorder, so no re-normalize needed.)
function keyedStates(parsed: any): Array<{ key: number; state: any }> {
  const out: Array<{ key: number; state: any }> = [];
  let current: any = null;
  for (const e of parsed?.events || []) {
    if (e?.event !== 'gamestate') continue;
    const arg = e?.args?.[0];
    if (!arg) continue;
    if (arg.full && typeof arg.full === 'object') current = clone(arg.full);
    else if (arg.patch && current) applyPatch(current, arg.patch);
    else continue;
    if (typeof e.key === 'number') out.push({ key: e.key, state: clone(current) });
  }
  return out;
}

// Mirror of the recorder's analyzeRecording action tally: count transitions of
// the action-phase active player across the ordered states.
function countActions(orderedStates: any[]): number {
  let last: string | null = null;
  let n = 0;
  for (const state of orderedStates) {
    const players = state?.players;
    if (!players) continue;
    let active: string | null = null;
    for (const pid of Object.keys(players)) {
      if (players[pid]?.isActionPhaseActivePlayer) { active = pid; break; }
    }
    if (active && active !== last) { n++; last = active; }
  }
  return n;
}

// Merge N parsed replay payloads (e.g. [storedBlob, incoming]) into one. Returns
// null if any payload lacks per-frame keys (caller falls back). Output is a
// valid version-2 payload: one {full} at the earliest key + forward {patch}
// deltas in key order, with merged metadata + key-remapped tags.
export function mergeSlices(payloads: any[]): any | null {
  if (!Array.isArray(payloads) || payloads.length === 0) return null;
  for (const p of payloads) if (!sliceHasKeys(p)) return null;

  // Union by key (same key = same moment → dedup; last write wins on ties).
  const byKey = new Map<number, any>();
  for (const p of payloads) for (const { key, state } of keyedStates(p)) byKey.set(key, state);
  const keys = [...byKey.keys()].sort((a, b) => a - b);
  if (keys.length === 0) return null;

  const keyToIndex = new Map<number, number>();
  keys.forEach((k, i) => keyToIndex.set(k, i));

  // Re-emit compact: first {full}, then forward diffs. Monotonic by key order.
  const orderedStates = keys.map((k) => byKey.get(k));
  const events: any[] = [];
  let prev: any = null;
  orderedStates.forEach((state, i) => {
    events.push(i === 0
      ? { t: i, dir: 'in', event: 'gamestate', key: keys[i], args: [{ full: state }] }
      : { t: i, dir: 'in', event: 'gamestate', key: keys[i], args: [{ patch: makePatch(prev, state) }] });
    prev = state;
  });

  // Merged metadata.
  const localPlayerId = payloads.map((p) => p.localPlayerId).find((v) => typeof v === 'string') ?? null;
  let match: any = null;
  for (const p of payloads) if (p.match) { match = p.match; break; }
  let decks: any = null;
  for (const p of payloads) decks = mergeDecks(decks, p.decks);
  const durationMs = Math.max(0, ...payloads.map((p) => Number(p.durationMs) || 0));

  // Tags: union by id; remap each tag's frameIndex via its stamped key.
  const tagById = new Map<string, any>();
  for (const p of payloads) {
    for (const t of (Array.isArray(p.tags) ? p.tags : [])) {
      if (!t || !t.id) continue;
      const remapped = typeof t.key === 'number' && keyToIndex.has(t.key)
        ? { ...t, frameIndex: keyToIndex.get(t.key) }
        : t;
      tagById.set(t.id, remapped);
    }
  }

  return {
    version: 2,
    url: payloads[0].url,
    startedAt: payloads[0].startedAt,
    reason: 'merged',
    durationMs,
    actionCount: countActions(orderedStates),
    localPlayerId,
    match,
    decks,
    events,
    tags: [...tagById.values()],
  };
}

// Final reconstructed state of a merged payload (for winner re-extraction).
export function mergedFinalState(merged: any): any | null {
  return reconstructFinalState(merged);
}
