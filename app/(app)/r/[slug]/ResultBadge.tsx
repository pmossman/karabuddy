// B59: small W / L badge for a player. Green W = winner, red L = loser.
// Render only when the parent replay has `winners` populated AND the
// player has a stable `id` (post-B59 uploads); otherwise return null so
// pre-B59 replays render cleanly without ambiguous badges.

interface Props {
  // The player's id (post-B59 uploads include this in serialized rows).
  playerId: string | null | undefined;
  // The replay's winner playerIds (jsonb on the row). Null for old
  // replays or games that ended via disconnect / abandon.
  winners: string[] | null | undefined;
}

export function ResultBadge({ playerId, winners }: Props) {
  if (!Array.isArray(winners) || winners.length === 0) return null;
  if (!playerId) return null;
  const won = winners.includes(playerId);
  return (
    <span
      data-testid={won ? 'result-badge-W' : 'result-badge-L'}
      title={won ? 'Won this match' : 'Lost this match'}
      style={{
        fontWeight: 800,
        color: won ? '#6bd968' : '#ff6b6b',
        letterSpacing: '0.04em',
        fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
      }}
    >
      {won ? 'W' : 'L'}
    </span>
  );
}
