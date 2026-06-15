// B150: sideboard diff — what a player swapped between two games of the same
// match (same karabast lobby). A SWU deck is a fixed size across a match, so the
// diff is a symmetric multiset delta over the post-sideboard card lists: cards
// whose count went UP are "in", cards whose count went DOWN are "out", and (deck
// size constant) the total in-count equals the total out-count. Pure +
// unit-tested; both surfaces (the decks-modal Sideboard panel + the frame-0
// splash) consume this.
import type { DeckCardRef } from './replayDecoder';

export interface SideboardChange { id: string; count: number; cost?: number | null; internalName?: string | null }
export interface SideboardDiff { in: SideboardChange[]; out: SideboardChange[]; changed: boolean }

// One player's swaps + their identity (for rendering the per-player panel/splash).
export interface SideboardPlayerChanges {
  playerId: string;
  username: string | null;
  leader: DeckCardRef | null;
  in: SideboardChange[];
  out: SideboardChange[];
  changed: boolean;
}
// The whole feature payload threaded into the viewer: the previous game number
// + each diffable player's swaps. Null when there's no previous game / no deck.
export interface SideboardChanges {
  fromGameNumber: number;
  players: SideboardPlayerChanges[];
}

const byCostThenId = (a: SideboardChange, b: SideboardChange) =>
  (a.cost ?? 99) - (b.cost ?? 99) || a.id.localeCompare(b.id);

// prevDeck → curDeck. Returns the cards swapped IN and OUT (with delta counts).
// `changed` is false when the lists are identical (the player kept the same 50).
export function sideboardDiff(prevDeck: DeckCardRef[] | null, curDeck: DeckCardRef[] | null): SideboardDiff | null {
  if (!Array.isArray(prevDeck) || !Array.isArray(curDeck)) return null;
  const prev = new Map<string, DeckCardRef>();
  for (const c of prevDeck) prev.set(c.id, c);
  const cur = new Map<string, DeckCardRef>();
  for (const c of curDeck) cur.set(c.id, c);

  const meta = (id: string): Pick<SideboardChange, 'cost' | 'internalName'> => {
    const c = cur.get(id) ?? prev.get(id);
    return { cost: c?.cost ?? null, internalName: c?.internalName ?? null };
  };

  const ins: SideboardChange[] = [];
  for (const [id, c] of cur) {
    const before = prev.get(id)?.count ?? 0;
    if (c.count > before) ins.push({ id, count: c.count - before, ...meta(id) });
  }
  const outs: SideboardChange[] = [];
  for (const [id, c] of prev) {
    const after = cur.get(id)?.count ?? 0;
    if (c.count > after) outs.push({ id, count: c.count - after, ...meta(id) });
  }

  ins.sort(byCostThenId);
  outs.sort(byCostThenId);
  return { in: ins, out: outs, changed: ins.length > 0 || outs.length > 0 };
}
