// B108: action-mode "stops" for the replay viewer. Stepping by action lands on
// these frame indices (and the play-through animates the frames between them).
//
// Originally a "stop" was only where the active player changed — which captures
// every action-phase action (plays/attacks alternate the active player), but
// SKIPS the regroup phase, where both players draw + resource without the active
// player alternating. So one action-step blew through all those beats at once.
//
// Now a frame is also a stop when a player DREW (their HAND grew — the deck pile
// is face-down/masked so it reads as 0 cards, so a draw only shows up as the
// hand getting bigger), DISCARDED (discard pile grew), or RESOURCED (resource
// pile grew) since the prior frame. Derived from pile counts — robust (no
// log-text matching) and works for both players (the opponent's piles are
// masked but still counted). A plain play shrinks the hand, so it doesn't
// trip the hand-grew check (and it's already an active-player boundary anyway).
// Pure + unit-tested.

function pileLen(player: any, zone: string): number {
  const list = player?.cardPiles?.[zone];
  return Array.isArray(list) ? list.length : 0;
}

export function computeActionStops(
  frames: ReadonlyArray<{ state: any }> | null | undefined,
  activeByFrame: ReadonlyArray<string | null> | null | undefined,
): number[] {
  if (!frames || frames.length === 0) return [];
  const stops = new Set<number>([0, frames.length - 1]);
  for (let i = 1; i < frames.length; i++) {
    if (activeByFrame && activeByFrame[i] !== activeByFrame[i - 1]) { stops.add(i); continue; }
    const cur = frames[i]?.state?.players;
    const prev = frames[i - 1]?.state?.players;
    if (!cur || !prev || typeof cur !== 'object' || typeof prev !== 'object') continue;
    for (const pid of Object.keys(cur)) {
      const p = cur[pid];
      const q = prev[pid];
      if (!q) continue;
      if (
        pileLen(p, 'resources') > pileLen(q, 'resources') || // resourced
        pileLen(p, 'discard') > pileLen(q, 'discard') ||      // discarded
        pileLen(p, 'hand') > pileLen(q, 'hand')               // drew (deck is masked)
      ) {
        stops.add(i);
        break;
      }
    }
  }
  return Array.from(stops).sort((a, b) => a - b);
}

// The next stop strictly after (dir > 0) / before (dir < 0) `from`. Clamps to
// the last/first stop at the ends. Because stepping always lands on a stop, a
// forward step then a back step are inverses.
export function nextActionStop(stops: number[], from: number, dir: 1 | -1): number {
  if (!stops || stops.length === 0) return from;
  if (dir > 0) {
    for (const s of stops) if (s > from) return s;
    return stops[stops.length - 1];
  }
  for (let i = stops.length - 1; i >= 0; i--) if (stops[i] < from) return stops[i];
  return stops[0];
}
