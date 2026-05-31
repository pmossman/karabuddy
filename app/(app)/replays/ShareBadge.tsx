// B89/B98: at-a-glance "who can see this" badge, shared by the replay grid card
// and the table view. Shared → one green pill per team it's surfaced to;
// unlisted → a muted lock chip (link-accessible, not surfaced to any team).
// `sharedTeams === undefined` (team grid / anonymous library, where share data
// isn't fetched) → renders nothing, so we never mislabel. Server-safe.
export function ShareBadge({ sharedTeams }: { sharedTeams?: { slug: string; name: string }[] }) {
  if (sharedTeams === undefined) return null;
  if (sharedTeams.length > 0) {
    return (
      <div data-testid="share-badge" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {sharedTeams.map((t) => (
          <span
            key={t.slug}
            style={{
              background: 'rgba(107, 217, 104, 0.1)',
              border: '1px solid rgba(107, 217, 104, 0.35)',
              color: '#7fd97f',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 8px',
              borderRadius: 999,
              letterSpacing: '0.02em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span aria-hidden>👥</span>{t.name}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div data-testid="share-badge">
      <span
        style={{
          background: 'rgba(108, 117, 136, 0.1)',
          border: '1px solid #2e333c',
          color: '#8a93a6',
          fontSize: 10,
          fontWeight: 700,
          padding: '1px 8px',
          borderRadius: 999,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span aria-hidden>🔒</span>Unlisted
      </span>
    </div>
  );
}
