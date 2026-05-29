// Canonical lookup tables + chip composer for replay match metadata
// (gameFormat / cardPool / gamesToWinMode). Lifted into one module so
// adding a new format (or renaming a label) is a single edit, not five.
//
// Note `cardPool === 'current'` is suppressed from the chip list — it's
// the default and would be noise on every chip row.

import type { MatchMeta } from './replayDecoder';

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
