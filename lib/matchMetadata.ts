// Canonical lookup tables + chip composer for replay match metadata
// (gameFormat / cardPool / gamesToWinMode). Lifted into one module so
// adding a new format (or renaming a label) is a single edit, not five.
//
// Note `cardPool === 'current'` is suppressed from the chip list — it's
// the default and would be noise on every chip row.

import type { MatchMeta } from './replayDecoder';
import { playerHandle } from './players';

// B203: a replay's "X vs Y" string (no displayName). `anonymize` (B122) forces
// leader names so no karabast handle leaks; otherwise it's handle-vs-handle.
// Was the `defaultTitleFor`/`matchupText` core, duplicated across the viewer +
// browser + feeds. NOTE: the replay-browser's perspective variant (leads with
// the viewer's own/opp leader) stays in ReplayFilters — it needs pre-resolved
// perspective fields this generic helper doesn't have; it still calls
// playerHandle for its fallback.
export function matchupVs(replay: { players?: unknown }, opts: { anonymize?: boolean } = {}): string {
  const players = Array.isArray(replay.players) ? replay.players : [];
  const [p1, p2] = players;
  if (!p1 && !p2) return 'Replay';
  if (opts.anonymize) {
    const lead = (p: any) => p?.leader?.name || 'Unknown';
    return `${lead(p1)} vs ${lead(p2)}`;
  }
  return `${playerHandle(p1)} vs ${playerHandle(p2)}`;
}

// B203: a replay's human title — a user-set displayName wins, else `matchupVs`.
export function matchupTitle(
  replay: { displayName?: string | null; players?: unknown },
  opts: { anonymize?: boolean } = {},
): string {
  return replay.displayName || matchupVs(replay, opts);
}

export const FORMAT_LABEL: Record<string, string> = {
  premier: 'Premier',
  eternal: 'Eternal',
  open: 'Open',
  limited: 'Limited',
};

export const POOL_LABEL: Record<string, string> = {
  current: 'Current',
  nextSet: 'Next Set',
  unlimited: 'Unlimited',
};

export const MODE_LABEL: Record<string, string> = {
  bestOfOne: 'Bo1',
  bestOfThree: 'Bo3',
};

// Compose the chip list for a replay's match metadata. Returns an empty
// array when meta is null (callers can `.length > 0`-gate their chip
// row). Order is stable: format, pool, mode.
export function matchChips(meta: MatchMeta | { gameFormat?: string | null; cardPool?: string | null; gamesToWinMode?: string | null } | null | undefined): string[] {
  if (!meta) return [];
  const out: string[] = [];
  if (meta.gameFormat && FORMAT_LABEL[meta.gameFormat]) out.push(FORMAT_LABEL[meta.gameFormat]);
  if (meta.cardPool && POOL_LABEL[meta.cardPool] && meta.cardPool !== 'current') out.push(POOL_LABEL[meta.cardPool]);
  if (meta.gamesToWinMode && MODE_LABEL[meta.gamesToWinMode]) out.push(MODE_LABEL[meta.gamesToWinMode]);
  return out;
}
