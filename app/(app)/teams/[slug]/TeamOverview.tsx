'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Panel } from '@/app/_components/Panel';
import { TacticalHeading } from '@/app/_components/TacticalHeading';
import { ResultBadge } from '@/app/(app)/r/[slug]/ResultBadge';
import { cardImageUrl } from '@/lib/cardImage';
import { tokens } from '@/app/_theme/karabuddyTokens';

// The team dashboard "hub" for someone actively running a team. Asymmetric
// layout: a main column of high-value feature cards (Reviews, Recent replays,
// Stats) and a narrower side column of context (Tournaments, Members,
// Discussion). Each card summarizes recent activity and deep-links to its tab.

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
  const needsReview = reviewReplays.filter((r) => (r.reviewerCount ?? 0) === 0);
  const reviewed = reviewReplays.filter((r) => (r.reviewerCount ?? 0) > 0);

  return (
    <>
      <style>{`
        .kb-dash { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; align-items: start; }
        .kb-dash-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
        @media (max-width: 1100px) { .kb-dash { grid-template-columns: 1fr; } }
      `}</style>

      <div className="kb-dash">
        {/* MAIN column */}
        <div className="kb-dash-col">
          {/* Reviews */}
          <Panel accent={counts.awaitingYou > 0} style={cardStyle}>
            <TacticalHeading action={<Link href={`/teams/${slug}?tab=review`} style={actionLink}>View all →</Link>}>
              Reviews
            </TacticalHeading>
            <div style={{ fontSize: 13, marginBottom: 2 }}>
              {counts.awaitingYou > 0 ? (
                <span><b style={{ font: `700 20px ${tokens.led.mono}`, color: tokens.led.on }}>{counts.awaitingYou}</b> <span style={{ color: '#dff4ff' }}>awaiting your review</span></span>
              ) : counts.openReviews > 0 ? (
                <span style={{ color: '#a0a8b8' }}>{counts.openReviews} open · you’re caught up</span>
              ) : (
                <span style={{ color: '#8a93a3' }}>All caught up — nothing waiting on a review.</span>
              )}
            </div>

            {needsReview.length > 0 && (
              <div>
                <SectionLabel>Needs review</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {needsReview.slice(0, 4).map((r) => (
                    <Link key={r.slug} href={`/r/${r.slug}`} style={rowLink}>
                      <span style={ellip}>{replayLabel(r)}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        {!r.reviewedByYou && <span style={{ fontSize: 11, color: tokens.led.on, fontWeight: 700 }}>needs you</span>}
                        <span style={metaText}>{r.requestedByName ? `${r.requestedByName} · ` : ''}{timeAgo(r.requestedAt)}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {reviewed.length > 0 && (
              <div>
                <SectionLabel>Recently reviewed</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {reviewed.slice(0, 3).map((r) => (
                    <Link key={r.slug} href={`/r/${r.slug}`} style={rowLink}>
                      <span style={ellip}>{replayLabel(r)}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: '#6bd968', fontWeight: 700 }}>✓ {r.reviewerCount}</span>
                        <span style={metaText}>{(r.reviewerNames ?? []).slice(0, 2).join(', ')}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          {/* Recent replays — rich rows (leaders/bases + W/L) */}
          <Panel style={cardStyle}>
            <TacticalHeading action={<Link href={`/teams/${slug}?tab=replays`} style={actionLink}>View all →</Link>}>
              Recent replays{counts.surfacedReplays > 0 ? ` · ${counts.surfacedReplays}` : ''}
            </TacticalHeading>
            {recentReplays.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentReplays.map((r) => {
                  const [p1, p2] = (r.players as any[]) || [];
                  return (
                    <Link key={r.slug} href={`/r/${r.slug}`} style={{ ...rowLink, gap: 8 }}>
                      <MiniDeck player={p1} align="left" />
                      <span style={{ fontSize: 10, color: '#6c7588', fontWeight: 700, flexShrink: 0 }}>VS</span>
                      <MiniDeck player={p2} align="right" />
                      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, flexShrink: 0, minWidth: 40 }}>
                        <span style={{ fontSize: 13 }}><ResultBadge playerId={r.ownerPlayerId} winners={r.winners} /></span>
                        <span style={metaText}>{timeAgo(r.createdAt)}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <Empty>No replays surfaced to this team yet. Share or tag a game to get started.</Empty>
            )}
          </Panel>

          {/* Stats — leader win-rate bars */}
          <StatsTrendCard slug={slug} />
        </div>

        {/* SIDE column */}
        <div className="kb-dash-col">
          {/* Tournaments */}
          <Panel accent={openTournaments.length > 0} style={cardStyle}>
            <TacticalHeading action={<Link href={`/teams/${slug}?tab=tournaments`} style={actionLink}>View all →</Link>}>
              Tournaments{counts.tournaments > 0 ? ` · ${counts.tournaments}` : ''}
            </TacticalHeading>
            {openTournaments.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {openTournaments.map((t) => (
                  <Link key={t.id} href={`/teams/${slug}/tournaments/${t.id}`} style={{ ...rowLink, flexDirection: 'column', alignItems: 'stretch', gap: 5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ ...ellip, fontWeight: 700 }}>{t.name}</span>
                      <StatusChip status={t.status} />
                    </span>
                    <span style={metaText}>{tournamentSummary(t)}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty>No active tournaments.{' '}<Link href={`/teams/${slug}?tab=tournaments`} style={{ color: tokens.color.accent, textDecoration: 'none' }}>Start one →</Link></Empty>
            )}
          </Panel>

          {/* Members — compact */}
          <Panel style={cardStyle}>
            <TacticalHeading action={<Link href={`/teams/${slug}?tab=members`} style={actionLink}>View all →</Link>}>
              Members · {counts.members}
            </TacticalHeading>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {members.slice(0, 8).map((m) => (
                <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px' }}>
                  <Avatar name={m.name} image={m.image} size={24} />
                  <span style={{ ...ellip, fontSize: 13, fontWeight: 600, color: '#d6d6d6', flex: 1 }}>{m.name || 'Unnamed'}</span>
                  {m.role === 'owner' && <span style={{ fontSize: 9, fontWeight: 700, color: '#5db4ff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Owner</span>}
                </div>
              ))}
            </div>
          </Panel>

          {/* Discussion — compact, demoted */}
          <Panel style={cardStyle}>
            <TacticalHeading action={<Link href={`/teams/${slug}?tab=discussion`} style={actionLink}>View all →</Link>}>
              Discussion
            </TacticalHeading>
            {recentDiscussion.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recentDiscussion.slice(0, 4).map((d) => (
                  <Link key={d.id} href={`/r/${d.replaySlug}`} style={{ display: 'flex', gap: 8, textDecoration: 'none', alignItems: 'flex-start' }}>
                    <Avatar name={d.author} image={d.authorImage} size={22} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                      <span style={{ ...ellip, fontSize: 12.5, color: '#d6d6d6' }}>{d.comment || '(no text)'}</span>
                      <span style={{ fontSize: 10.5, color: '#8a93a3' }}>{d.author} · {timeAgo(d.createdAt)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty>No discussion yet — tag a moment on a team replay.</Empty>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

// -- Stats card (separate client fetch; stats logic stays out of /overview) ---
interface LeaderStat { leader: string; games: number; wins: number; winRate: number | null }
function StatsTrendCard({ slug }: { slug: string }) {
  const [rows, setRows] = useState<LeaderStat[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    fetch(`/api/stats?scope=team&team=${slug}&type=leaders`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        if (!live) return;
        const data: LeaderStat[] = Array.isArray(j.data) ? j.data : [];
        setRows(data);
        const ids = data.map((r) => r.leader).filter(Boolean);
        if (ids.length) {
          fetch(`/api/cards?ids=${ids.join(',')}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((cb) => { if (live && cb?.cards) setNames(Object.fromEntries(Object.entries(cb.cards).map(([id, v]: any) => [id, v.name || id]))); })
            .catch(() => {});
        }
      })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [slug]);

  const top = (rows ?? [])
    .filter((r) => r.games >= 2 && r.winRate != null)
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
    .slice(0, 5);

  return (
    <Panel style={cardStyle}>
      <TacticalHeading action={<Link href={`/teams/${slug}?tab=stats`} style={actionLink}>View all →</Link>}>
        Leader win rates
      </TacticalHeading>
      {rows === null ? (
        <Empty>Loading…</Empty>
      ) : top.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {top.map((r) => {
            const pct = Math.round((r.winRate ?? 0) * 100);
            const [set, num] = r.leader.split('_');
            const img = cardImageUrl({ set, number: num }, true);
            return (
              <div key={r.leader} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <CardThumb src={img} alt={names[r.leader]} w={40} h={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                    <span style={{ ...ellip, fontSize: 12.5, fontWeight: 600, color: '#e6e6e6' }}>{names[r.leader] || r.leader}</span>
                    <span style={{ fontSize: 11.5, color: '#8a93a3', flexShrink: 0 }}><b style={{ color: '#dff4ff' }}>{pct}%</b> · {r.games}g</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: 'linear-gradient(90deg, #4d9dff, #4dd2ff)' }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty>Not enough games tracked yet. Record a few and your team’s meta shows up here.</Empty>
      )}
    </Panel>
  );
}

// -- shared bits -------------------------------------------------------------
const cardStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const rowLink: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '8px 10px', borderRadius: 8, textDecoration: 'none',
  background: 'rgba(255,255,255,0.025)', border: '1px solid #21262f',
};
const ellip: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#e6e6e6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const metaText: React.CSSProperties = { fontSize: 11, color: '#8a93a3', whiteSpace: 'nowrap' };

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: '#5b6472', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: '4px 0 6px' }}>{children}</div>;
}

function MiniDeck({ player, align }: { player: any; align: 'left' | 'right' }) {
  const leaderImg = cardImageUrl(player?.leader ?? null, true);
  const baseImg = cardImageUrl(player?.base ?? null, false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, flexDirection: align === 'right' ? 'row-reverse' : 'row' }}>
      <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        <CardThumb src={leaderImg} alt={player?.leader?.name} w={36} h={26} />
        <CardThumb src={baseImg} alt={player?.base?.name} w={36} h={26} />
      </span>
      <span style={{ minWidth: 0, textAlign: align === 'right' ? 'right' : 'left' }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#e6e6e6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player?.leader?.name || 'Unknown'}</span>
        <span style={{ display: 'block', fontSize: 10.5, color: '#8a93a3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player?.base?.name || ''}</span>
      </span>
    </div>
  );
}

function CardThumb({ src, alt, w, h }: { src: string | null; alt?: string; w: number; h: number }) {
  if (!src) {
    return <span style={{ width: w, height: h, borderRadius: 3, background: '#0a0c10', display: 'inline-block', flexShrink: 0 }} title={alt} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt || ''} loading="lazy" style={{ width: w, height: h, objectFit: 'contain', borderRadius: 3, background: '#0a0c10', flexShrink: 0 }} />;
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

function tournamentSummary(t: Tourney): string {
  const s = t.status;
  if (s === 'setup' || s === 'registration' || s === 'open') {
    return `Registration open · ${t.entrantCount} ${t.entrantCount === 1 ? 'entrant' : 'entrants'}`;
  }
  if (s === 'completed') return `Completed · ${t.entrantCount} players`;
  const round = t.roundCount > 0 ? `Round ${t.roundCount}${t.plannedRounds ? ` of ${t.plannedRounds}` : ''}` : 'Underway';
  return `${round} · ${t.entrantCount} players`;
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
    <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[0, 1, 2].map((i) => <Panel key={i} style={{ height: 180 }}><span /></Panel>)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[0, 1, 2].map((i) => <Panel key={i} style={{ height: 150 }}><span /></Panel>)}
      </div>
    </div>
  );
}
