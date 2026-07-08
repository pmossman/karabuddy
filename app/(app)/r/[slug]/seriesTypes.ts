// B129/B216: the games of a Bo3 series, computed server-side (page.tsx seriesFor)
// for identity-entitled viewers — only when 2+ games of the match were recorded.
// Rendered by the redesign Matchup view as full per-game replay-summary rows.
export interface SeriesGame {
  slug: string;
  gameNumber: number;
  // Matchup summary for the row (players ordered owner-first, plus the winner set).
  players?: any[] | null;
  ownerPlayerId?: string | null;
  winners?: string[] | null;
}

export interface SeriesInfo {
  current: number; // 1-based game number of THIS replay
  games: SeriesGame[];
}

// B229: the game AFTER the one being viewed (for the end-of-game "next game"
// prompt), or null on the last recorded game / a non-series replay.
export function nextSeriesGame(series: SeriesInfo | null | undefined): { slug: string; gameNumber: number } | null {
  if (!series) return null;
  const next = series.games.find((g) => g.gameNumber === series.current + 1);
  return next ? { slug: next.slug, gameNumber: next.gameNumber } : null;
}
