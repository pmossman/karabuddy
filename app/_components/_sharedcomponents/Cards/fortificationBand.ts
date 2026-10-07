// karabuddy (Fortify, Homeworlds): how a base's fortification band splits its
// cards into tabs. The band is one non-wrapping row hanging off the base's
// board-facing edge, so it holds a fixed number of slots. Past that, the OLDEST
// cards collapse into one "+N" chip at the start of the row and the newest keep
// named tabs, so the card just played always has a tab to land on. `slots`
// counts the chip itself: 4 cards in 3 slots is "+2" and two named tabs.
export const FORTIFICATION_SLOTS = 3;

export function fortificationTabs<T>(cards: readonly T[], slots = FORTIFICATION_SLOTS): { collapsed: T[]; shown: T[] } {
  if (cards.length <= slots) return { collapsed: [], shown: [...cards] };
  const keep = Math.max(0, slots - 1);
  return { collapsed: cards.slice(0, cards.length - keep), shown: cards.slice(cards.length - keep) };
}
