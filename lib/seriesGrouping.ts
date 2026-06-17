// B158: segment a karabast lobby's games into individual MATCHES.
//
// A karabast lobby persists across rematches, so its `lobbyId` can span many
// games — several Bo3s (or a long string of Bo1s) played back-to-back. Grouping
// purely by lobbyId therefore produced bogus "Best of 11" series. We instead
// segment a lobby's games (chronological) into matches using the match FORMAT:
// a Best-of-N match closes as soon as one side reaches the wins-to-win, or at N
// games, whichever comes first; then the next game starts a fresh match.
//
// The win tally is from the VIEWER's perspective (win/loss per game) — stable
// across a single recorder's own games even though karabast's per-game player
// UUIDs are not. Games with no winner signal advance no one's tally (the game
// cap still closes an abandoned match).

export function winsToWin(format: string | null | undefined): number {
  switch (format) {
    case 'bestOfThree': return 2;
    case 'bestOfFive': return 3;
    default: return 1; // bestOfOne + anything unknown = single game
  }
}

// Max games a match of this format can run (N in "Best of N").
export function maxGames(format: string | null | undefined): number {
  return winsToWin(format) * 2 - 1;
}

// Human label, or null when the format is unknown (caller can fall back).
export function bestOfLabel(format: string | null | undefined): string | null {
  const known: Record<string, number> = { bestOfOne: 1, bestOfThree: 3, bestOfFive: 5 };
  const n = format ? known[format] : undefined;
  return n ? `Best of ${n}` : null;
}

// Segment a chronologically-ordered list of a lobby's games into matches.
// `wonOf(g)` returns true (viewer won), false (viewer lost), or null (unknown).
export function segmentMatches<T>(
  games: T[],
  wonOf: (g: T) => boolean | null,
  format: string | null | undefined,
): T[][] {
  const need = winsToWin(format);
  const cap = maxGames(format);
  const out: T[][] = [];
  let cur: T[] = [];
  let me = 0, opp = 0;
  for (const g of games) {
    cur.push(g);
    const w = wonOf(g);
    if (w === true) me++;
    else if (w === false) opp++;
    if (me >= need || opp >= need || cur.length >= cap) {
      out.push(cur);
      cur = []; me = 0; opp = 0;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}
