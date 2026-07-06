// B158 / B224: segment a karabast lobby's games into individual MATCHES.
//
// A karabast lobby persists across rematches, so its `lobbyId` can span many
// games — several Bo3s (or a long string of Bo1s) played back-to-back. Grouping
// purely by lobbyId therefore produced bogus "Best of 11" series. We instead
// segment a lobby's games (chronological) into matches using the match FORMAT:
// a Best-of-N match closes as soon as one side reaches the wins-to-win, or at N
// games, whichever comes first; then the next game starts a fresh match.
//
// B224 — Bo1→Bo3 conversion: karabast lets players finish a Bo1 and THEN turn
// it into a Bo3 (the pre-conversion game counts as game 1). We snapshot
// `gamesToWinMode` at each game's start, so that first game is recorded
// `bestOfOne` while games 2–3 read `bestOfThree`. A per-game format that keyed
// on the first game alone therefore split a converted set into standalone Bo1s.
// The segmentation now looks one game ahead: a `bestOfOne` game immediately
// followed by a multi-game format IS the converted game 1 of that set and
// inherits its format.
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

export interface Match<T> {
  games: T[];
  format: string; // the effective format of the match (conversion-aware)
}

// The format of a match STARTING at index `i`. Conversion-aware: a bestOfOne
// game whose NEXT game is a multi-game format is that set's converted game 1,
// so it inherits the following game's format. Otherwise the game's own format.
function startFormat<T>(games: T[], i: number, formatOf: (g: T) => string | null | undefined): string {
  const own = formatOf(games[i]) ?? 'bestOfOne';
  if (winsToWin(own) === 1 && i + 1 < games.length) {
    const next = formatOf(games[i + 1]);
    if (next && winsToWin(next) > 1) return next; // converted game 1 of a Bo3/Bo5 set
  }
  return own;
}

// Segment a chronologically-ordered list of a lobby's games into matches.
// `wonOf(g)` returns true (viewer won), false (lost), or null (unknown).
// `formatOf(g)` is each game's recorded `gamesToWinMode` (conversion-aware).
export function segmentMatches<T>(
  games: T[],
  wonOf: (g: T) => boolean | null,
  formatOf: (g: T) => string | null | undefined,
): Match<T>[] {
  const out: Match<T>[] = [];
  let cur: T[] = [];
  let fmt = 'bestOfOne';
  let me = 0, opp = 0;
  for (let i = 0; i < games.length; i++) {
    if (cur.length === 0) {
      fmt = startFormat(games, i, formatOf);
      me = 0; opp = 0;
    }
    cur.push(games[i]);
    const w = wonOf(games[i]);
    if (w === true) me++;
    else if (w === false) opp++;
    if (me >= winsToWin(fmt) || opp >= winsToWin(fmt) || cur.length >= maxGames(fmt)) {
      out.push({ games: cur, format: fmt });
      cur = [];
    }
  }
  if (cur.length) out.push({ games: cur, format: fmt });
  return out;
}

// The effective (conversion-aware) format of EACH game, in input order — the
// format of the match it belongs to. Drives both the Bo3 label and the stats
// bo3 flag from one segmentation, so grouping and classification never drift.
export function effectiveFormats<T>(
  games: T[],
  wonOf: (g: T) => boolean | null,
  formatOf: (g: T) => string | null | undefined,
): string[] {
  const out: string[] = [];
  for (const m of segmentMatches(games, wonOf, formatOf)) {
    for (let k = 0; k < m.games.length; k++) out.push(m.format);
  }
  return out;
}
