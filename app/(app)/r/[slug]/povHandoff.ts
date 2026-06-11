// B128: pure decision logic for the double-sided "hotseat" auto-POV mode —
// when watching with auto-switch on, the viewer follows the ACTIVE player:
// each time the action passes to the other side, the board fades to black and
// comes back from that player's recorded perspective (both teammates' POVs
// exist on a double-sided replay, B112).

// karabast marks whose action it is on each gamestate.
export function frameActivePlayerId(frame: { state?: { players?: Record<string, any> } } | null | undefined): string | null {
  const players = frame?.state?.players;
  if (!players) return null;
  for (const [pid, p] of Object.entries(players)) {
    if ((p as any)?.isActionPhaseActivePlayer === true) return pid;
  }
  return null;
}

// The actor whose action frame N's VISUALS show. karabast advances
// `isActionPhaseActivePlayer` to the NEXT actor the moment an action resolves,
// so frame N's own flag is one action AHEAD of what's on screen — the actor of
// frame N's visuals is the flag of frame N−1 (verified against real replays:
// the attack log lines of frame N always match frame N−1's flag). Frame 0 has
// no predecessor — its own flag (the game's first actor) is the right answer.
export function actorOfFrameVisuals(
  frames: ({ state?: { players?: Record<string, any> } } | null | undefined)[],
  index: number
): string | null {
  return frameActivePlayerId(frames[Math.max(0, index - 1)] ?? null);
}

// Flip only when the CURRENT FRAME'S VISUALS belong to the other recording's
// side (lagged attribution via actorOfFrameVisuals). Requiring the actor to be
// EXACTLY the other side (instead of just "≠ shown") means a malformed /
// missing flag, or an id that belongs to neither recording, can never cause a
// flip loop.
export function shouldHandoff(opts: {
  frames: ({ state?: { players?: Record<string, any> } } | null | undefined)[];
  index: number; // current frame index in `frames`
  shownLocalId: string | null | undefined; // localPlayerId of the POV on screen
  otherLocalId: string | null | undefined; // localPlayerId of the other recording
}): boolean {
  const { frames, index, shownLocalId, otherLocalId } = opts;
  if (!shownLocalId || !otherLocalId || shownLocalId === otherLocalId) return false;
  const actor = actorOfFrameVisuals(frames, index);
  return actor !== null && actor !== shownLocalId && actor === otherLocalId;
}
