// Reorder a replay's players[] so the recorder's POV (the owner) is
// listed first. Postgres jsonb does NOT preserve insertion order — it
// normalizes by key length then alpha — so the raw players[] from the
// DB can have the owner second when their playerId happens to sort
// after the opponent's. Every rendering surface ("X vs Y", matchup
// thumbs, viewer header, etc.) expects "owner vs opponent", so apply
// this at the serialization boundary.
//
// No-op when ownerPlayerId is null/unknown (pre-B59 rows; anonymous
// uploads where the recorder POV wasn't captured), when there's only
// one player, or when the owner is already first.
export function orderPlayersOwnerFirst(
  players: unknown,
  ownerPlayerId: string | null | undefined,
): any[] {
  if (!Array.isArray(players)) return [];
  if (!ownerPlayerId) return players;
  const idx = players.findIndex((p) => p?.id === ownerPlayerId);
  if (idx <= 0) return players; // not found, or already first
  return [players[idx], ...players.slice(0, idx), ...players.slice(idx + 1)];
}
