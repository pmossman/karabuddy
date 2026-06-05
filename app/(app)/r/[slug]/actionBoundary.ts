// B104: pure action-boundary stepping for the replay viewer. Extracted from
// ReplayViewer so the off-by-one symmetry is unit-testable.
//
// Actions are runs of consecutive frames sharing an active player. The
// canonical landing spot for an action is its FIRST frame (where it begins).
// Both directions snap to segment STARTS, so a forward step then a back step
// are inverses: from an action start, forward → next action start, and back
// from there returns you to the original start.
//
// The naive "walk while the active player is unchanged" lands forward on the
// next segment's start but backward on the *previous* segment's END, which
// isn't symmetric (B104 bug: 102 → forward → 107 → back → 106, not 102).
export function actionBoundary(
  activeByFrame: ReadonlyArray<string | null>,
  total: number,
  from: number,
  dir: 1 | -1,
): number {
  if (total <= 0) return from;
  if (dir > 0) {
    // First frame whose active player differs from `from` = start of the next
    // segment. Clamp to the last frame at the end of the replay.
    const cur = activeByFrame[from];
    let n = from + 1;
    while (n < total && activeByFrame[n] === cur) n += 1;
    return n >= total ? total - 1 : n;
  }
  // Backward: the start of the run containing the frame just before `from` =
  // the largest segment-start strictly less than `from`.
  if (from <= 0) return 0;
  const prev = activeByFrame[from - 1];
  let n = from - 1;
  while (n > 0 && activeByFrame[n - 1] === prev) n -= 1;
  return n;
}
