// Pure client-side controls for the Stats views (StatsClient). The stats data is
// fully client-held, so the sort + minimum-occurrences filtering happen here with
// no refetch. Shared across the Leaders, Cards, and matchup-axis lists via
// accessors (count = games for leaders/decks, observations for cards).

export type SortKey = 'games' | 'winrate' | 'name';
export type SortDir = 'asc' | 'desc';

export interface StatAccessors<T> {
  count: (r: T) => number; // games (leaders/decks) or observations (cards)
  winPct: (r: T) => number | null; // rounded win rate, or null when no decisive result
  name: (r: T) => string;
}

export function winRatePct(wins: number, decisive: number): number | null {
  return decisive > 0 ? Math.round((wins / decisive) * 100) : null;
}

// Keep rows at/above the minimum-occurrences threshold. `min <= 1` is a no-op
// (show everything). `count` reads games or observations per the view.
export function filterMinGames<T>(rows: T[], min: number, count: (r: T) => number): T[] {
  return min <= 1 ? rows : rows.filter((r) => count(r) >= min);
}

// Sort a COPY of the rows (never mutates the input). Rows with no win rate (no
// decisive result) ALWAYS sink to the bottom — they can't top "best win %" and
// shouldn't lead "worst" either; direction only orders the rows that have a rate.
// Ties break by sample size so the more-supported row leads.
export function sortStatRows<T>(rows: T[], key: SortKey, dir: SortDir, acc: StatAccessors<T>): T[] {
  const s = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ca = acc.count(a), cb = acc.count(b);
    if (key === 'name') return s * acc.name(a).localeCompare(acc.name(b)) || cb - ca;
    if (key === 'games') return s * (ca - cb) || (acc.winPct(b) ?? -1) - (acc.winPct(a) ?? -1);
    // winrate
    const wa = acc.winPct(a), wb = acc.winPct(b);
    if (wa == null && wb == null) return cb - ca;
    if (wa == null) return 1; // a sinks
    if (wb == null) return -1; // b sinks
    return s * (wa - wb) || cb - ca;
  });
}
