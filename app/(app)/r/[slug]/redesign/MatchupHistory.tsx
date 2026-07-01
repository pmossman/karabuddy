'use client';

import { tokens } from '@/app/_theme/karabuddyTokens';
import { ReplayMatchup } from '@/app/_components/ReplayMatchup';

// B216 redesign — "History vs <opponent>" in the Matchup view. The uploader's own
// other recorded matches against the same opponent (owner-only, computed server-
// side), grouped by lobby so a best-of-3 reads as one series, newest first.

export interface OpponentHistory {
  opponent: string;
  groups: {
    date: string;         // ISO — most recent game in the group
    bestOf: boolean;      // more than one game → a series
    games: { slug: string; gameNumber: number; won: boolean | null; players: any; ownerPlayerId: string | null; winners: string[] | null; createdAt: string }[];
  }[];
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

const chip = (won: boolean | null): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800, textDecoration: 'none', fontFamily: 'inherit',
  border: `1px solid ${won === true ? 'rgba(107,217,104,0.5)' : won === false ? 'rgba(255,138,122,0.5)' : 'rgba(255,255,255,0.16)'}`,
  background: won === true ? 'rgba(107,217,104,0.12)' : won === false ? 'rgba(255,138,122,0.12)' : 'rgba(255,255,255,0.05)',
  color: won === true ? '#9be89a' : won === false ? '#ffb0a5' : 'rgba(255,255,255,0.75)',
});

export function MatchupHistory({ history }: { history: OpponentHistory }) {
  if (!history.groups.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: tokens.color.textMuted }}>History vs {history.opponent}</div>
      {history.groups.map((g, i) => {
        const wins = g.games.filter((x) => x.won === true).length;
        const losses = g.games.filter((x) => x.won === false).length;
        const head = g.games[0];
        const inner = (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span suppressHydrationWarning style={{ fontSize: 11.5, color: tokens.color.textSecondary, fontWeight: 600 }}>{fmtDate(g.date)}</span>
              {g.bestOf && <span style={{ fontSize: 10.5, fontWeight: 700, color: tokens.color.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Bo{g.games.length} · {wins}–{losses}</span>}
            </div>
            <ReplayMatchup players={head.players} ownerPlayerId={head.ownerPlayerId} winners={head.winners} thumb={30} showNames={false} />
            {g.bestOf && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {g.games.map((game) => (
                  <a key={game.slug} href={`/r/${game.slug}`} style={chip(game.won)}>Game {game.gameNumber} · {game.won === true ? 'W' : game.won === false ? 'L' : '–'}</a>
                ))}
              </div>
            )}
          </>
        );
        const cardStyle: React.CSSProperties = { display: 'block', textAlign: 'left', padding: '11px 12px', borderRadius: 10, border: `1px solid ${tokens.color.border}`, background: 'rgba(255,255,255,0.03)', textDecoration: 'none', color: 'inherit' };
        return g.bestOf
          ? <div key={i} style={cardStyle}>{inner}</div>
          : <a key={i} href={`/r/${head.slug}`} style={{ ...cardStyle, cursor: 'pointer' }} title={`Open ${fmtDate(g.date)}`}>{inner}</a>;
      })}
    </div>
  );
}
