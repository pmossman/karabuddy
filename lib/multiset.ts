// Multiset (bag) helpers over string ids, dup-safe. Used across the
// opening-drills pick/keep comparisons on both the client (card coloring,
// comparability) and the server (consensus, hand-mapping, pick overlap) —
// "does this bag of cards contain those cards" and "how many overlap".

/** True if `pool` contains every id in `items`, counting duplicates. */
export function multisetContains(pool: readonly string[], items: readonly string[]): boolean {
  const bag = [...pool];
  for (const id of items) {
    const at = bag.indexOf(id);
    if (at < 0) return false;
    bag.splice(at, 1);
  }
  return true;
}

/** Count of ids in `a` that also appear in `b`, each `b` entry matched once. */
export function multisetOverlap(a: readonly string[], b: readonly string[]): number {
  const bag = [...b];
  let n = 0;
  for (const id of a) {
    const at = bag.indexOf(id);
    if (at >= 0) { bag.splice(at, 1); n += 1; }
  }
  return n;
}

/** True if two id bags are equal (same members, same multiplicities). */
export function multisetEquals(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && multisetContains(a, b);
}
