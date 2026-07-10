// B227: sideboard decision extraction. A sideboard between Bo3 games is just
// the DIFF of the recorder's decklist across the two games — karabast records
// the (sideboarded) decklist per game, so game N+1's list minus game N's list
// is exactly what was swapped. Pure; the DB plumbing lives in sideboardPersist.

export const SIDEBOARD_EXTRACTOR_VERSION = 1;

export interface SideCard { id: string; count: number; cost?: number | null }

// id → total copies across a decklist (dup-safe).
function countMap(cards: SideCard[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cards) if (c?.id) m.set(c.id, (m.get(c.id) ?? 0) + (c.count ?? 1));
  return m;
}

// The swap that turns `deckBefore` into `deckAfter`: per-id count delta →
// positive copies brought IN, negative copies taken OUT (both as cardId
// multisets, sorted for stable storage/compare).
export function computeSwap(deckBefore: SideCard[], deckAfter: SideCard[]): { swappedIn: string[]; swappedOut: string[] } {
  const before = countMap(deckBefore);
  const after = countMap(deckAfter);
  const ids = new Set([...before.keys(), ...after.keys()]);
  const swappedIn: string[] = [];
  const swappedOut: string[] = [];
  for (const id of ids) {
    const delta = (after.get(id) ?? 0) - (before.get(id) ?? 0);
    for (let k = 0; k < delta; k++) swappedIn.push(id);
    for (let k = 0; k < -delta; k++) swappedOut.push(id);
  }
  swappedIn.sort();
  swappedOut.sort();
  return { swappedIn, swappedOut };
}
