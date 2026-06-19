'use client';

import { useEffect, useState } from 'react';
import { ReplayMatchup } from '@/app/_components/ReplayMatchup';
import { decryptSummary } from '@/lib/companion';
import { orderPlayersOwnerFirst } from '@/lib/players';

// B170 / ADR 0010: the matchup card for a replay that MIGHT be private. For a
// plaintext replay it's just ReplayMatchup. For an encrypted one the server
// holds no plaintext (players=[]/winners=null), so we decrypt the small summary
// client-side via the extension bridge and render the leaders/bases/result from
// it — or a compact "🔒 Private" placeholder when the key/extension isn't there.
//
// `row` carries both the plaintext fields (non-encrypted) and the encrypted
// summary pointer; pass a SerializedReplayRow or anything with these fields.

interface MatchupRow {
  encrypted?: boolean;
  teamKeyId?: string | null;
  encryptedSummary?: string | null;
  players: any[] | null | undefined;
  ownerPlayerId: string | null | undefined;
  winners: string[] | null | undefined;
}

// The encrypted summary stores `winners` as the RAW karabast signal (usernames
// or playerIds), same as a plaintext upload. Normalize to playerIds against the
// summary's players map so ResultBadge's `winners.includes(playerId)` works —
// mirrors the server's extractWinners normalization.
function normalizeWinners(raw: unknown, playersById: Record<string, any>): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((w): w is string => typeof w === 'string' && !!w)
    .map((w) => (playersById[w] ? w : Object.entries(playersById).find(([, p]) => p?.username === w)?.[0] ?? w));
}

export function PrivateMatchup({ row, thumb = 36, showNames = true }: { row: MatchupRow; thumb?: number; showNames?: boolean }) {
  const [decoded, setDecoded] = useState<{ players: any[]; ownerPlayerId: string | null; winners: string[] | null } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!row.encrypted) return;
    let cancelled = false;
    (async () => {
      try {
        if (!row.teamKeyId || !row.encryptedSummary) throw new Error('no summary');
        const s = await decryptSummary<any>(row.teamKeyId, row.encryptedSummary);
        if (cancelled) return;
        const byId: Record<string, any> = s.players && typeof s.players === 'object' ? s.players : {};
        const playersArr = Object.entries(byId).map(([id, p]: [string, any]) => ({ id, ...p }));
        setDecoded({
          players: orderPlayersOwnerFirst(playersArr, s.ownerPlayerId ?? null) as any[],
          ownerPlayerId: s.ownerPlayerId ?? null,
          winners: normalizeWinners(s.winners, byId),
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [row.encrypted, row.teamKeyId, row.encryptedSummary]);

  if (!row.encrypted) {
    return <ReplayMatchup players={row.players} ownerPlayerId={row.ownerPlayerId} winners={row.winners} thumb={thumb} showNames={showNames} />;
  }
  if (decoded) {
    return <ReplayMatchup players={decoded.players} ownerPlayerId={decoded.ownerPlayerId} winners={decoded.winners} thumb={thumb} showNames={showNames} />;
  }
  // Encrypted, not yet decrypted (resolving) or can't (no extension / key) →
  // a compact, non-blank placeholder so the row still reads as a real replay.
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#8a93a3', fontSize: 12, fontWeight: 600, minWidth: 0 }}>
      <span style={{ fontSize: 14 }}>🔒</span>
      <span>{failed ? 'Private — load your team key' : 'Private replay'}</span>
    </span>
  );
}
