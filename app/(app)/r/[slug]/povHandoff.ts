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

// Flip only when the frame's active player is EXACTLY the other recording's
// side. Requiring the match (instead of just "≠ shown") means a malformed /
// missing active flag, or an id that belongs to neither recording, can never
// cause a flip loop.
export function shouldHandoff(opts: {
  frame: { state?: { players?: Record<string, any> } } | null | undefined;
  shownLocalId: string | null | undefined; // localPlayerId of the POV on screen
  otherLocalId: string | null | undefined; // localPlayerId of the other recording
}): boolean {
  const { frame, shownLocalId, otherLocalId } = opts;
  if (!shownLocalId || !otherLocalId || shownLocalId === otherLocalId) return false;
  const active = frameActivePlayerId(frame);
  return active !== null && active !== shownLocalId && active === otherLocalId;
}
