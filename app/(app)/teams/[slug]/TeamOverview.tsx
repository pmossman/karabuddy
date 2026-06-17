'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Panel } from '@/app/_components/Panel';
import { TacticalHeading } from '@/app/_components/TacticalHeading';
import { ReplayMatchup } from '@/app/_components/ReplayMatchup';
import { tokens } from '@/app/_theme/karabuddyTokens';

// The team dashboard "hub" for someone actively running a team. When a
// tournament is active it leads with a full-width hero (live standings or
// registration). Below: Team replays + Reviews side by side, then a slim
// Discussion activity feed. Self-fetches the member-gated /overview bundle.

interface Standing { rank: number; name: string; wins: number; losses: number; draws: number; points: number }
interface ActiveTournament { id: string; name: string; status: string; entrantCount: number; currentRound: number; plannedRounds: number | null; standings: Standing[]; registrants: string[] }
interface Disc { id: string; replaySlug: string; comment: string; createdAt: string; author: string; authorImage: string | null; matchup: string }
interface OverviewData {
  counts: { tournaments: number; openReviews: number; awaitingYou: number; surfacedReplays: number; members: number };
  activeTournaments: ActiveTournament[];
  reviewReplays: any[];
  recentlyReviewed: any[];
  recentDiscussion: Disc[];
  recentReplays: any[];
}

const actionLink: React.CSSProperties = {
  font: `700 11px ${tokens.led.mono}`, letterSpacing: '0.08em', color: tokens.color.accent, textDecoration: 'none', textTransform: 'uppercase',
};

export function TeamOverview({ slug }: { slug: string }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/teams/${slug}/overview`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (live) setData(j); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [slug]);

  if (error) return <p style={{ color: '#a0a8b8', fontSize: 13 }}>Couldn’t load the dashboard. Try refreshing.</p>;
  if (!data) return <DashboardSkeleton />;

  const { counts, activeTournaments, reviewReplays, recentlyReviewed, recentDiscussion, recentReplays } = data;
  const needsReview = reviewReplays.filter((r) => (r.reviewerCount ?? 0) === 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`
        .kb-dash-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
        @media (max-width: 1000px) { .kb-dash-2col { grid-template-columns: 1fr; } }
        .kb-tourney-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
      `}</style>

      {/* Active tournament(s) — full-width hero above everything else. */}
      {activeTournaments.length > 0 && (
        <Panel accent style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <TacticalHeading action={<Link href={`/teams/${slug}?tab=tournaments`} style={actionLink}>All tournaments →</Link>}>
            {activeTournaments.length === 1 ? 'Active tournament' : `Active tournaments · ${activeTournaments.length}`}
          </TacticalHeading>
          <div className="kb-tourney-grid">
            {activeTournaments.map((t) => <TournamentPanel key={t.id} slug={slug} t={t} />)}
          </div>
        </Panel>
      )}

      {/* Team replays + Reviews, side by side. */}
      <div className="kb-dash-2col">
        {/* Team replays */}
        <Panel style={cardStyle}>
          <TacticalHeading action={<Link href={`/teams/${slug}?tab=replays`} style={actionLink}>View all →</Link>}>
            Team replays{counts.surfacedReplays > 0 ? ` · ${counts.surfacedReplays}` : ''}
          </TacticalHeading>
          {recentReplays.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recentReplays.map((r) => (
                <Link key={r.slug} href={`/r/${r.slug}`} style={{ ...rowLink, flexDirection: 'column', alignItems: 'stretch', gap: 5 }}>
                  <ReplayMatchup players={r.players} ownerPlayerId={r.ownerPlayerId} winners={r.winners} thumb={36} />
                  <span style={metaText}>{r.ownerName ? `${r.ownerName} · ` : ''}{timeAgo(r.createdAt)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty>No replays surfaced to this team yet. Share or tag a game to get started.</Empty>
          )}
        </Panel>

        {/* Reviews — needs-review + recently-completed */}
        <Panel accent={counts.awaitingYou > 0} style={cardStyle}>
          <TacticalHeading action={<Link href={`/teams/${slug}?tab=review`} style={actionLink}>View all →</Link>}>
            Reviews
          </TacticalHeading>
          <div style={{ fontSize: 13 }}>
            {counts.awaitingYou > 0 ? (
              <span><b style={{ font: `700 20px ${tokens.led.mono}`, color: tokens.led.on }}>{counts.awaitingYou}</b> <span style={{ color: '#dff4ff' }}>awaiting your review</span></span>
            ) : counts.openReviews > 0 ? (
              <span style={{ color: '#a0a8b8' }}>{counts.openReviews} open · you’re caught up</span>
            ) : (
              <span style={{ color: '#8a93a3' }}>Nothing waiting on a review.</span>
            )}
          </div>

          {needsReview.length > 0 && (
            <div>
              <SectionLabel>Needs review</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {needsReview.slice(0, 3).map((r) => (
                  <Link key={r.slug} href={`/r/${r.slug}`} style={{ ...rowLink, flexDirection: 'column', alignItems: 'stretch', gap: 5 }}>
                    <ReplayMatchup players={r.players} ownerPlayerId={r.ownerPlayerId} winners={r.winners} thumb={28} />
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {!r.reviewedByYou && <span style={{ fontSize: 11, color: tokens.led.on, fontWeight: 700 }}>needs you</span>}
                      <span style={{ ...metaText, marginLeft: 'auto' }}>{r.requestedByName ? `${r.requestedByName} · ` : ''}{timeAgo(r.requestedAt)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {recentlyReviewed.length > 0 && (
            <div>
              <SectionLabel>Recently reviewed</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentlyReviewed.slice(0, 3).map((r) => (
                  <Link key={r.slug} href={`/r/${r.slug}`} style={{ ...rowLink, flexDirection: 'column', alignItems: 'stretch', gap: 5 }}>
                    <ReplayMatchup players={r.players} ownerPlayerId={r.ownerPlayerId} winners={r.winners} thumb={28} />
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#6bd968', fontWeight: 700 }}>✓ reviewed</span>
                      <span style={{ ...metaText, marginLeft: 'auto' }}>{(r.reviewerNames ?? []).slice(0, 2).join(', ')} · {timeAgo(r.reviewedAt)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {needsReview.length === 0 && recentlyReviewed.length === 0 && (
            <Empty>No reviews yet — request a review on a replay to get feedback from the team.</Empty>
          )}
        </Panel>
      </div>

      {/* Discussion — slim full-width activity feed. */}
      <Panel style={cardStyle}>
        <TacticalHeading action={<Link href={`/teams/${slug}?tab=discussion`} style={actionLink}>View all →</Link>}>
          Discussion
        </TacticalHeading>
        {recentDiscussion.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {recentDiscussion.slice(0, 4).map((d) => (
              <Link key={d.id} href={`/r/${d.replaySlug}`} style={{ display: 'flex', gap: 8, textDecoration: 'none', alignItems: 'flex-start' }}>
                <Avatar name={d.author} image={d.authorImage} size={24} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12.5, color: '#d6d6d6', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{d.comment || '(no text)'}</span>
                  <span style={{ fontSize: 10.5, color: '#8a93a3' }}>{d.author} · {d.matchup} · {timeAgo(d.createdAt)}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>No discussion yet — tag a moment on a team replay to start one.</Empty>
        )}
      </Panel>
    </div>
  );
}

// One active tournament inside the hero — live standings (in-progress) or the
// registrant list (registration).
function TournamentPanel({ slug, t }: { slug: string; t: ActiveTournament }) {
  const href = `/teams/${slug}/tournaments/${t.id}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid #21262f' }}>
      <Link href={href} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textDecoration: 'none' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#e6e6e6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
        <StatusChip status={t.status} />
      </Link>
      <span style={metaText}>{tournamentSummary(t)}</span>

      {t.standings.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {t.standings.map((s) => (
            <div key={s.rank} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12.5 }}>
              <span style={{ width: 18, color: '#6c7588', fontWeight: 700, flexShrink: 0, textAlign: 'right' }}>{s.rank}</span>
              <span style={{ flex: 1, color: '#d6d6d6', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
              <span style={{ color: '#8a93a3', flexShrink: 0 }}>{s.wins}-{s.losses}{s.draws ? `-${s.draws}` : ''}</span>
              <span style={{ color: '#dff4ff', fontWeight: 700, flexShrink: 0, minWidth: 34, textAlign: 'right' }}>{s.points} pt</span>
            </div>
          ))}
          <Link href={href} style={{ ...actionLink, marginTop: 4 }}>Full standings →</Link>
        </div>
      ) : t.registrants.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {t.registrants.map((n, i) => (
            <span key={`${n}-${i}`} style={{ fontSize: 12, fontWeight: 600, color: '#d6d6d6', padding: '3px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.03)', border: '1px solid #21262f' }}>{n}</span>
          ))}
        </div>
      ) : (
        <Empty>No entrants yet. <Link href={href} style={{ color: tokens.color.accent, textDecoration: 'none' }}>Manage →</Link></Empty>
      )}
    </div>
  );
}

// -- shared bits -------------------------------------------------------------
const cardStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const rowLink: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '8px 10px', borderRadius: 8, textDecoration: 'none',
  background: 'rgba(255,255,255,0.025)', border: '1px solid #21262f',
};
const metaText: React.CSSProperties = { fontSize: 11, color: '#8a93a3', whiteSpace: 'nowrap' };

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: '#5b6472', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: '4px 0 6px' }}>{children}</div>;
}

function Avatar({ name, image, size }: { name: string | null; image: string | null; size: number }) {
  const initials = (name || '?').replace(/@.*/, '').trim().slice(0, 2).toUpperCase() || '?';
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: image ? 'transparent' : '#2e333c', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontSize: size * 0.4, fontWeight: 700, color: '#d6d6d6' }}>{initials}</span>}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const live = status === 'in-progress' || status === 'active' || status === 'started';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
      padding: '2px 7px', borderRadius: 4, flexShrink: 0,
      color: live ? tokens.led.on : '#8a93a3',
      background: live ? 'rgba(77,210,255,0.12)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${live ? 'rgba(77,210,255,0.3)' : '#2e333c'}`,
    }}>
      {status}
    </span>
  );
}

function tournamentSummary(t: ActiveTournament): string {
  const s = t.status;
  if (s === 'setup' || s === 'registration' || s === 'open') {
    return `Registration open · ${t.entrantCount} ${t.entrantCount === 1 ? 'entrant' : 'entrants'}`;
  }
  const round = t.currentRound > 0 ? `Round ${t.currentRound}${t.plannedRounds ? ` of ${t.plannedRounds}` : ''}` : 'Underway';
  return `${round} · ${t.entrantCount} players`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, fontSize: 13, color: '#8a93a3', lineHeight: 1.5 }}>{children}</p>;
}

function DashboardSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Panel style={{ height: 150 }}><span /></Panel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Panel style={{ height: 220 }}><span /></Panel>
        <Panel style={{ height: 220 }}><span /></Panel>
      </div>
    </div>
  );
}
