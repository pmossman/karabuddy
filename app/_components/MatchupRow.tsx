import { LeaderBasePair } from '@/app/_components/LeaderBasePair';

// The [leader/base · VS · leader/base] header row shared verbatim by ReplayCard
// and ClipCard. (The rest of each card's body legitimately differs — replay
// metadata/labels/actions vs clip title/frame-meta/delete — so only this row is
// shared, not a full card shell.)
function Side({ player }: { player: any }) {
  if (!player) return <div style={{ flex: 1 }} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, alignItems: 'center', minWidth: 0 }}>
      <LeaderBasePair leader={player.leader} base={player.base} width={90} height={64} radius={4} gap={4} align="center" fallback="name" />
    </div>
  );
}

export function MatchupRow({ p1, p2 }: { p1: unknown; p2: unknown }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
      <Side player={p1} />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#6c7588' }}>VS</span>
      <Side player={p2} />
    </div>
  );
}
