// B228: recover "named card" associations from the replay's game log. Cards
// like Ryder Azadi name another card; karabast keeps that ONLY in the message
// stream (never on the card object), as a structured message:
//   [ <player>, " names <NamedCard> using ", <cardObject with uuid> ]
// We scan every frame's messages and map the NAMING card's uuid → the named
// card's name, so the viewer can stamp it onto the card and show a persistent
// bubble instead of relying on the log line (which scrolls away).
//
// The map is whole-game + last-wins per uuid: a naming happens the beat the
// card enters and persists while it's in play, and uuids never repeat within a
// game, so the bubble only ever appears while that card is actually on board.

// " names X using " — the named card is the capture; the card it's "using" is
// the next element (the naming card object). Tolerant of "name"/"names".
const NAMES_RE = /\bnames?\s+(.+?)\s+using\b/i;

export function buildNamedCardMap(messagesByFrame: any[][] | null | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!Array.isArray(messagesByFrame)) return map;
  for (const frame of messagesByFrame) {
    for (const entry of Array.isArray(frame) ? frame : []) {
      const parts = Array.isArray(entry) ? entry : entry?.message;
      if (!Array.isArray(parts)) continue;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (typeof p !== 'string') continue;
        const m = p.match(NAMES_RE);
        if (!m) continue;
        const next = parts[i + 1];
        const uuid = next && typeof next === 'object' && typeof next.uuid === 'string' ? next.uuid : null;
        if (uuid) map[uuid] = m[1].trim();
      }
    }
  }
  return map;
}

// Stamp `namedCard` onto every card in a frame's gamestate whose uuid was
// named. In-place + idempotent (deterministic per uuid), so it's safe to run
// on each frame push.
export function stampNamedCards(state: any, namedMap: Record<string, string>): void {
  if (!state?.players || Object.keys(namedMap).length === 0) return;
  for (const player of Object.values(state.players) as any[]) {
    for (const zone of Object.values(player?.cardPiles ?? {}) as any[]) {
      for (const card of Array.isArray(zone) ? zone : []) {
        if (card?.uuid && namedMap[card.uuid]) card.namedCard = namedMap[card.uuid];
      }
    }
  }
}
