'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Panel } from '@/app/_components/Panel';
import { TacticalHeading } from '@/app/_components/TacticalHeading';
import { tokens } from '@/app/_theme/karabuddyTokens';

// The team dashboard "hub": a balanced set of feature-activity cards for someone
// actively running a team — what's happening across Tournaments / Reviews /
// Discussion, plus a compact Recent-replays list and a Members strip. Each card
// summarizes recent state and deep-links to its tab. Self-fetches the
// member-gated /overview bundle.

interface Member { userId: string; role: string; name: string | null; image: string | null }
interface Tourney { id: string; name: string; status: string; entrantCount: number; roundCount: number; plannedRounds: number | null; startedAt: string | null }
interface Disc { id: string; replaySlug: string; comment: string; createdAt: string; author: string; authorImage: string | null; matchup: string }
interface OverviewData {
  counts: { tournaments: number; openReviews: number; awaitingYou: number; surfacedReplays: number; members: number };
  members: Member[];
  openTournaments: Tourney[];
  reviewReplays: any[];
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

  const { counts, members, openTournaments, reviewReplays, recentDiscussion, recentReplays } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`
        .kb-dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
        @media (max-width: 1100px) { .kb-dash-grid { grid-template-columns: 1fr; } }
      `}</style>

      {/* Members strip */}
      <Panel hud={false} padding={14} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ font: `700 11px ${tokens.led.mono}`, letterSpacing: '0.1em', color: '#8a93a3', textTransform: 'uppercase' }}>
          Members · {counts.members}
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 }}>
          {members.map((m) => (
            <span key={m.userId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px 3px 3px', borderRadius: 999, background: 'rgba(255,255,255,0.03)', border: '1px solid #21262f' }}>
              <Avatar name={m.name} image={m.image} size={20} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#d6d6d6' }}>{m.name || 'Unnamed'}</span>
              {m.role === 'owner' && <span style={{ fontSize: 9, fontWeight: 700, color: '#5db4ff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Owner</span>}
            </span>
          ))}
        </div>
        <Link href={`/teams/${slug}?tab=members`} style={actionLink}>View all →</Link>
      </Panel>

      <div className="kb-dash-grid">
        {/* Tournaments */}
        <Panel accent={openTournaments.length > 0} style={cardStyle}>
          <TacticalHeading action={<Link href={`/teams/${slug}?tab=tournaments`} style={actionLink}>View all →</Link>}>
            Tournaments{counts.tournaments > 0 ? ` · ${counts.tournaments}` : ''}
          </TacticalHeading>
          {openTournaments.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {openTournaments.map((t) => (
                <Link key={t.id} href={`/teams/${slug}/tournaments/${t.id}`} style={{ ...rowLink, flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#e6e6e6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    <StatusChip status={t.status} />
                  </span>
                  <span style={{ fontSize: 12, color: '#8a93a3' }}>{tournamentSummary(t)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty>
              No active tournaments.{' '}
              <Link href={`/teams/${slug}?tab=tournaments`} style={{ color: tokens.color.accent, textDecoration: 'none' }}>Start one →</Link>
            </Empty>
          )}
        </Panel>

        {/* Reviews */}
        <Panel accent={counts.awaitingYou > 0} style={cardStyle}>
          <TacticalHeading action={<Link href={`/teams/${slug}?tab=review`} style={actionLink}>View all →</Link>}>
            Reviews
          </TacticalHeading>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 2 }}>
            {counts.awaitingYou > 0 ? (
              <>
                <span style={{ font: `700 30px ${tokens.led.mono}`, color: tokens.led.on, lineHeight: 1 }}>{counts.awaitingYou}</span>
                <span style={{ fontSize: 13, color: '#dff4ff' }}>awaiting your review</span>
              </>
            ) : counts.openReviews > 0 ? (
              <span style={{ fontSize: 13, color: '#a0a8b8' }}>{counts.openReviews} awaiting review · you’re caught up</span>
            ) : (
              <span style={{ fontSize: 13, color: '#8a93a3' }}>All caught up — nothing waiting on a review.</span>
            )}
          </div>
          {reviewReplays.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {reviewReplays.map((r) => (
                <Link key={r.slug} href={`/r/${r.slug}`} style={rowLink}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#e6e6e6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{replayLabel(r)}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {r.reviewedByYou
                      ? <span style={{ fontSize: 11, color: '#6bd968', fontWeight: 700 }}>✓ reviewed</span>
                      : <span style={{ fontSize: 11, color: tokens.led.on, fontWeight: 700 }}>needs you</span>}
                    <span style={{ fontSize: 11, color: '#8a93a3' }}>{timeAgo(r.requestedAt)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        {/* Discussion */}
        <Panel style={cardStyle}>
          <TacticalHeading action={<Link href={`/teams/${slug}?tab=discussion`} style={actionLink}>View all →</Link>}>
            Discussion
          </TacticalHeading>
          {recentDiscussion.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recentDiscussion.map((d) => (
                <Link key={d.id} href={`/r/${d.replaySlug}`} style={{ display: 'flex', gap: 9, textDecoration: 'none' }}>
                  <Avatar name={d.author} image={d.authorImage} size={26} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 12, color: '#8a93a3' }}>
                      <span style={{ color: '#cdd4df', fontWeight: 700 }}>{d.author}</span> · {d.matchup} · {timeAgo(d.createdAt)}
                    </span>
                    <span style={{ fontSize: 13, color: '#d6d6d6', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {d.comment || '(no text)'}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty>No discussion yet — tag a moment on a team replay to start one.</Empty>
          )}
        </Panel>

        {/* Recent replays — compact list */}
        <Panel style={cardStyle}>
          <TacticalHeading action={<Link href={`/teams/${slug}?tab=replays`} style={actionLink}>View all →</Link>}>
            Recent replays{counts.surfacedReplays > 0 ? ` · ${counts.surfacedReplays}` : ''}
          </TacticalHeading>
          {recentReplays.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recentReplays.map((r) => (
                <Link key={r.slug} href={`/r/${r.slug}`} style={rowLink}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#e6e6e6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{replayLabel(r)}</span>
                  <span style={{ fontSize: 11, color: '#8a93a3', flexShrink: 0 }}>{timeAgo(r.createdAt)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty>No replays surfaced to this team yet. Share or tag a game to get started.</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const rowLink: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '8px 10px', borderRadius: 8, textDecoration: 'none',
  background: 'rgba(255,255,255,0.025)', border: '1px solid #21262f',
};

function tournamentSummary(t: Tourney): string {
  const s = t.status;
  if (s === 'setup' || s === 'registration' || s === 'open') {
    return `Registration open · ${t.entrantCount} ${t.entrantCount === 1 ? 'entrant' : 'entrants'}`;
  }
  if (s === 'completed') return `Completed · ${t.entrantCount} players`;
  // In progress.
  const round = t.roundCount > 0 ? `Round ${t.roundCount}${t.plannedRounds ? ` of ${t.plannedRounds}` : ''}` : 'Underway';
  return `${round} · ${t.entrantCount} players`;
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

function replayLabel(r: any): string {
  if (r.displayName) return r.displayName;
  const players = (r.players as any[]) || [];
  const names = players.map((p) => p?.username || p?.name).filter(Boolean);
  return names.length >= 2 ? `${names[0]} vs ${names[1]}` : (names[0] || 'Replay');
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
      <Panel hud={false} padding={14} style={{ height: 48 }}><span /></Panel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 16 }}>
        {[0, 1, 2, 3].map((i) => <Panel key={i} style={{ height: 180 }}><span /></Panel>)}
      </div>
    </div>
  );
}
