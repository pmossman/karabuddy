import { ResultBadge } from '@/app/(app)/r/[slug]/ResultBadge';
import { LeaderBasePair } from '@/app/_components/LeaderBasePair';

// Canonical compact replay representation: leader + base art for BOTH sides and
// the W/L outcome (from the recorder's POV). Used everywhere a replay is shown
// in miniature — dashboard rows, the reviews list, the sidebar's Latest replay —
// so every replay card carries the same identifying art + result, at any size.
// `thumb` sets the card-art width; `showNames` adds the leader/base names beside
// the art (drop them in tight spaces like the sidebar).
export function ReplayMatchup({
  players,
  ownerPlayerId,
  winners,
  thumb = 36,
  showNames = true,
}: {
  players: any[] | null | undefined;
  ownerPlayerId: string | null | undefined;
  winners: string[] | null | undefined;
  thumb?: number;
  showNames?: boolean;
}) {
  const [p1, p2] = (players as any[]) || [];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <Deck player={p1} align="left" thumb={thumb} showNames={showNames} />
      <span style={{ fontSize: 10, color: '#6c7588', fontWeight: 700, flexShrink: 0 }}>VS</span>
      <Deck player={p2} align="right" thumb={thumb} showNames={showNames} />
      <span style={{ fontSize: 13, flexShrink: 0, minWidth: 14, textAlign: 'right' }}>
        <ResultBadge playerId={ownerPlayerId ?? null} winners={winners ?? null} />
      </span>
    </div>
  );
}

function Deck({ player, align, thumb, showNames }: { player: any; align: 'left' | 'right'; thumb: number; showNames: boolean }) {
  const h = Math.round(thumb * 0.72);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, overflow: 'hidden', flexDirection: align === 'right' ? 'row-reverse' : 'row' }}>
      <LeaderBasePair leader={player?.leader} base={player?.base} orientation="overlap" reverse={align === 'right'} width={thumb} height={h} fit="cover" radius={3} />
      {showNames && (
        // Names drop on phones (the kb-rm-names media rule) so the art + W/L
        // always fit; the leader/base art carries the identity there.
        <span className="kb-rm-names" style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textAlign: align === 'right' ? 'right' : 'left' }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#e6e6e6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player?.leader?.name || 'Unknown'}</span>
          <span style={{ display: 'block', fontSize: 10.5, color: '#8a93a3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player?.base?.name || ''}</span>
        </span>
      )}
    </div>
  );
}

