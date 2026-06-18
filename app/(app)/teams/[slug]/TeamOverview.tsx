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
interface Pairing { table: number; name1: string; name2: string | null; winnerName: string | null; status: string; score: string }
interface ActiveTournament { id: string; name: string; status: string; entrantCount: number; currentRound: number; currentRoundNumber: number; plannedRounds: number | null; standings: Standing[]; pairings: Pairing[]; registrants: string[] }
interface Disc { id: string; replaySlug: string; comment: string; createdAt: string; author: string; authorImage: string | null; matchup: string }
interface OverviewData {
  counts: { tournaments: number; openRequests: number; awaiting: number; surfacedReplays: number; members: number };
  activeTournaments: ActiveTournament[];
  awaitingReviews: any[];
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

  const { counts, activeTournaments, awaitingReviews, recentlyReviewed, recentDiscussion, recentReplays } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`
        .kb-dash-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
        @media (max-width: 1000px) { .kb-dash-2col { grid-template-columns: 1fr; } }
        .kb-tourney-grid { display: flex; flex-direction: column; gap: 16px; }
        .kb-tourney-split { display: grid; grid-template-columns: 1.05fr 1fr; gap: 18px; }
        @media (max-width: 760px) { .kb-tourney-split { grid-template-columns: 1fr; } }
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

        {/* Reviews — explicit requests awaiting feedback (prominent) + the
            team's actual review feedback (comments on replays). */}
        <Panel accent={counts.awaiting > 0} style={cardStyle}>
          <TacticalHeading action={<Link href={`/teams/${slug}?tab=review`} style={actionLink}>View all →</Link>}>
            Reviews
          </TacticalHeading>

          {awaitingReviews.length > 0 && (
            <div>
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                <b style={{ font: `700 20px ${tokens.led.mono}`, color: tokens.led.on }}>{counts.awaiting}</b>{' '}
                <span style={{ color: '#dff4ff' }}>requested {counts.awaiting === 1 ? 'review' : 'reviews'} awaiting feedback</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {awaitingReviews.map((r) => (
                  <Link key={r.slug} href={`/r/${r.slug}`} style={{ ...rowLink, flexDirection: 'column', alignItems: 'stretch', gap: 5, borderColor: 'rgba(77,210,255,0.3)', background: 'rgba(77,210,255,0.05)' }}>
                    <ReplayMatchup players={r.players} ownerPlayerId={r.ownerPlayerId} winners={r.winners} thumb={28} />
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: tokens.led.on, fontWeight: 700 }}>needs review</span>
                      <span style={{ ...metaText, marginLeft: 'auto' }}>{r.requestedByName ? `${r.requestedByName} requested · ` : ''}{timeAgo(r.requestedAt)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {recentlyReviewed.length > 0 ? (
            <div>
              <SectionLabel>Recent feedback</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentlyReviewed.map((r) => (
                  <Link key={r.slug} href={`/r/${r.slug}`} style={{ ...rowLink, flexDirection: 'column', alignItems: 'stretch', gap: 5 }}>
                    <ReplayMatchup players={r.players} ownerPlayerId={r.ownerPlayerId} winners={r.winners} thumb={28} />
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#6bd968', fontWeight: 700 }}>✓ {r.commentCount} {r.commentCount === 1 ? 'note' : 'notes'}</span>
                      <span style={{ ...metaText, marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(r.reviewerNames ?? []).slice(0, 2).join(', ')} · {timeAgo(r.reviewedAt)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : awaitingReviews.length === 0 ? (
            <Empty>No review feedback yet — comment on a teammate’s replay to leave one, or request a review on yours.</Empty>
          ) : null}
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
              <Link key={d.id} href={`/r/${d.replaySlug}`} style={{ display: 'flex', gap: 8, textDecoration: 'none', alignItems: 'flex-start', paddingRight: 10 }}>
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

const MEDAL = ['#f2c14e', '#cfd4dd', '#cd7f4d']; // gold / silver / bronze

// One active tournament inside the hero — round progress, podium standings with
// points bars, and the current round's pairings (the live "bracket" view), or
// the registrant roster while in registration.
function TournamentPanel({ slug, t }: { slug: string; t: ActiveTournament }) {
  const href = `/teams/${slug}/tournaments/${t.id}`;
  const inProgress = t.standings.length > 0;
  const maxPoints = Math.max(1, ...t.standings.map((s) => s.points));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 12, background: 'linear-gradient(180deg, rgba(77,157,255,0.06), rgba(255,255,255,0.015))', border: '1px solid #2a3340' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', minWidth: 0 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
          <StatusChip status={t.status} />
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={metaText}>{tournamentSummary(t)}</span>
          {t.plannedRounds ? <RoundDots current={t.currentRoundNumber} total={t.plannedRounds} /> : null}
        </div>
      </div>

      {inProgress ? (
        <div className="kb-tourney-split">
          {/* Standings — podium + points bars */}
          <div>
            <SectionLabel>Standings</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {t.standings.map((s) => {
                const medal = s.rank <= 3 ? MEDAL[s.rank - 1] : null;
                return (
                  <div key={s.rank} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 800, color: medal ? '#0d1016' : '#8a93a3',
                      background: medal ?? 'rgba(255,255,255,0.05)', border: medal ? 'none' : '1px solid #2e333c',
                    }}>{s.rank}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', color: '#e6e6e6', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                      <span style={{ display: 'block', height: 4, borderRadius: 2, marginTop: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: '100%', width: `${(s.points / maxPoints) * 100}%`, background: medal ? `linear-gradient(90deg, ${medal}, #4dd2ff)` : 'linear-gradient(90deg, #4d9dff, #4dd2ff)' }} />
                      </span>
                    </span>
                    <span style={{ flexShrink: 0, color: '#8a93a3', fontSize: 12, minWidth: 42, textAlign: 'right' }}>{s.wins}-{s.losses}{s.draws ? `-${s.draws}` : ''}</span>
                    <span style={{ flexShrink: 0, color: '#dff4ff', fontWeight: 800, minWidth: 28, textAlign: 'right' }}>{s.points}</span>
                  </div>
                );
              })}
            </div>
            <Link href={href} style={{ ...actionLink, display: 'inline-block', marginTop: 8 }}>Full standings →</Link>
          </div>

          {/* Current round pairings — the live board */}
          <div>
            <SectionLabel>Round {t.currentRoundNumber}{t.plannedRounds ? ` of ${t.plannedRounds}` : ''}</SectionLabel>
            {t.pairings.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {t.pairings.slice(0, 8).map((p) => <PairingRow key={p.table} p={p} />)}
              </div>
            ) : (
              <Empty>Pairings not posted yet.</Empty>
            )}
          </div>
        </div>
      ) : t.registrants.length > 0 ? (
        <div>
          <SectionLabel>Registered · {t.entrantCount}</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {t.registrants.map((n, i) => (
              <span key={`${n}-${i}`} style={{ fontSize: 12.5, fontWeight: 600, color: '#d6d6d6', padding: '4px 11px', borderRadius: 999, background: 'rgba(77,157,255,0.07)', border: '1px solid rgba(77,157,255,0.22)' }}>{n}</span>
            ))}
          </div>
          <Link href={href} style={{ ...actionLink, display: 'inline-block', marginTop: 10 }}>Manage tournament →</Link>
        </div>
      ) : (
        <Empty>No entrants yet. <Link href={href} style={{ color: tokens.color.accent, textDecoration: 'none' }}>Manage →</Link></Empty>
      )}
    </div>
  );
}

function PairingRow({ p }: { p: Pairing }) {
  const done = !!p.winnerName || p.name2 === null;
  const w1 = p.winnerName != null && p.winnerName === p.name1;
  const w2 = p.winnerName != null && p.winnerName === p.name2;
  const side = (name: string | null, win: boolean) => (
    <span style={{ flex: 1, minWidth: 0, color: win ? '#7fe08a' : name === null ? '#6c7588' : '#d6d6d6', fontWeight: win ? 800 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name ?? 'BYE'}</span>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 8px', borderRadius: 7, background: 'rgba(255,255,255,0.02)', border: '1px solid #21262f' }}>
      <span style={{ width: 16, flexShrink: 0, color: '#6c7588', fontWeight: 700, fontSize: 11 }}>{p.table}</span>
      {side(p.name1, w1)}
      <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: done ? '#8a93a3' : tokens.led.on, minWidth: 30, textAlign: 'center' }}>{p.name2 === null ? 'bye' : done ? p.score : 'live'}</span>
      {side(p.name2, w2)}
    </div>
  );
}

function RoundDots({ current, total }: { current: number; total: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {Array.from({ length: Math.min(total, 8) }, (_, i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: i < current ? tokens.led.on : 'rgba(255,255,255,0.12)', boxShadow: i < current ? '0 0 5px rgba(77,210,255,0.6)' : 'none' }} />
      ))}
    </span>
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
