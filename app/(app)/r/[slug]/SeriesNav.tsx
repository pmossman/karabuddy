'use client';

import Link from 'next/link';

// B129: hop between the games of a Bo3 series from inside the viewer.
// Rendered under the replay title (desktop sidebar + mobile matchup panel)
// when the replay's match.lobbyId has 2+ recorded games. Game numbers are
// play order (createdAt asc) among the RECORDED games — if game 1 wasn't
// captured, the labels shift, which is the honest representation of what
// we have.

export interface SeriesGame {
  slug: string;
  gameNumber: number;
  // Enriched (viewer-entitled only) so a full matchup-summary row can render per
  // game; the legacy pill nav below ignores these.
  players?: any[] | null;
  ownerPlayerId?: string | null;
  winners?: string[] | null;
}

export interface SeriesInfo {
  current: number; // 1-based game number of THIS replay
  games: SeriesGame[];
}

export function SeriesNav({ series }: { series: SeriesInfo }) {
  return (
    <div
      data-testid="series-nav"
      style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#6c7588',
        }}
      >
        Series
      </span>
      {series.games.map((g) => {
        const isCurrent = g.gameNumber === series.current;
        const pillStyle: React.CSSProperties = {
          borderRadius: 999,
          padding: '1px 9px',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.03em',
          whiteSpace: 'nowrap',
          textDecoration: 'none',
          background: isCurrent ? 'rgba(77,157,255,0.22)' : 'transparent',
          border: `1px solid ${isCurrent ? 'rgba(77,157,255,0.7)' : 'rgba(77,157,255,0.3)'}`,
          color: isCurrent ? '#ffffff' : '#a7d2ff',
        };
        if (isCurrent) {
          return (
            <span key={g.slug} aria-current="page" style={pillStyle}>
              Game {g.gameNumber}
            </span>
          );
        }
        return (
          <Link
            key={g.slug}
            href={`/r/${g.slug}`}
            prefetch={false}
            data-testid={`series-game-${g.gameNumber}`}
            style={pillStyle}
          >
            Game {g.gameNumber}
          </Link>
        );
      })}
    </div>
  );
}
