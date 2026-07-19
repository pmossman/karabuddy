// Shared result-display bits for the replay lists (table + grid cards). A game
// karabast left unscored (winners null) that COULD be scored — a real,
// non-encrypted game with a known POV — gets the amber "No result" chip so it
// calls attention; the Result filter's "No result" surfaces them all at once.

export function noResult(r: { winners?: string[] | null; ownerPlayerId?: string | null; encrypted?: boolean }): boolean {
  return !r.encrypted && !!r.ownerPlayerId && !(Array.isArray(r.winners) && r.winners.length > 0);
}

export function NoResultChip() {
  return (
    <span data-testid="no-result-chip" title="No win/loss recorded — set one so it counts in stats"
      style={{ background: 'rgba(224,164,58,0.14)', border: '1px solid rgba(224,164,58,0.5)', color: '#e0a44a', borderRadius: 999, padding: '0 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
      No result
    </span>
  );
}

export function ManualResultDot() {
  return <span title="Result set manually" style={{ fontSize: 10, color: '#8a93a3', fontWeight: 700, whiteSpace: 'nowrap' }}>· set</span>;
}
