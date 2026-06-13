// B107: anonymize a replay for public "sample" display. Real karabast handles
// are replaced with "Player1" / "Player2" consistently across every surface a
// signed-out visitor sees — the replay card, the viewer matchup + title, the
// board labels, and the in-game log. Display-layer only; stored data is never
// touched. Labels are assigned by player ORDER (owner-first upstream), so the
// mapping is stable and the card + viewer agree. No space in the label so it
// never wraps in the narrow board name tags (real handles are single tokens).

export function anonLabel(index: number): string {
  return `Player${index + 1}`;
}

// id → label, in the given players' array order.
export function anonByIdFromPlayers(players: Array<{ id?: string }> | null | undefined): Map<string, string> {
  const m = new Map<string, string>();
  (players || []).forEach((p, i) => { if (p?.id) m.set(p.id, anonLabel(i)); });
  return m;
}

// id → label, derived from the DECODED FRAMES. The stored `players` summary
// carries no player id (only username), so a summary-keyed map is empty and
// anonymization silently no-ops — the real ids live ONLY as the frame's
// `state.players` keys. Labels are owner-first (so "Player1" = the uploader,
// matching the owner-first matchup) when `ownerPlayerId` is known, else in
// first-seen order. Every player present in the frames gets a label, so no real
// handle can survive.
export function anonByIdFromFrames(
  frames: Array<{ state?: any }> | null | undefined,
  ownerPlayerId?: string | null,
): Map<string, string> {
  const m = new Map<string, string>();
  const fp = (frames || []).find((f) => f?.state?.players && typeof f.state.players === 'object')?.state.players;
  if (!fp) return m;
  let ids = Object.keys(fp);
  if (ownerPlayerId && ids.includes(ownerPlayerId)) ids = [ownerPlayerId, ...ids.filter((i) => i !== ownerPlayerId)];
  ids.forEach((id, i) => m.set(id, anonLabel(i)));
  return m;
}

// Players summary with usernames swapped for anon labels — everything else
// (leader / base / result) is preserved so the matchup still shows the decks.
export function anonymizePlayersSummary<T extends { username?: string }>(players: T[] | null | undefined): T[] {
  return (players || []).map((p, i) => ({ ...p, username: anonLabel(i) }));
}

// Decks keyed by player id — swap each deck's username for that player's label
// and DROP the user-authored deck name/title (a common identity leak, e.g.
// "Parker's Vader"). The card lists are kept (showing the decklist is the whole
// point of a sample). Returns a new object; input is untouched.
export function anonymizeDecks(
  decks: Record<string, { username?: string | null; name?: string | null }> | null | undefined,
  byId: Map<string, string>,
): Record<string, any> | null {
  if (!decks) return null;
  const out: Record<string, any> = {};
  for (const [pid, d] of Object.entries(decks)) {
    out[pid] = { ...(d as any), username: byId.get(pid) ?? 'Player', name: null };
  }
  return out;
}

// Rewrite decoded frames so the board + game log read anonymized: each player's
// `user.username` and any player-typed log-message part → that player's label.
// Mutates the frames in place (the viewer's own decoded copy).
export function anonymizeFrames(frames: Array<{ state: any }> | null | undefined, byId: Map<string, string>): void {
  if (!frames) return;
  for (const f of frames) {
    const players = f?.state?.players;
    if (players && typeof players === 'object') {
      for (const pid of Object.keys(players)) {
        const label = byId.get(pid);
        if (!label) continue;
        const p = players[pid];
        if (p && typeof p === 'object') {
          if (!p.user || typeof p.user !== 'object') p.user = {};
          p.user.username = label;
        }
      }
    }
    const msgs = f?.state?.newMessages;
    if (Array.isArray(msgs)) {
      for (const m of msgs) {
        const parts = m?.message;
        if (!Array.isArray(parts)) continue;
        for (const part of parts) {
          if (part && typeof part === 'object' && part.type === 'player' && part.id && byId.has(part.id)) {
            part.name = byId.get(part.id);
          }
        }
      }
    }
  }
}
