'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Panel } from '@/app/_components/Panel';
import { TacticalHeading } from '@/app/_components/TacticalHeading';
import { ReplayCard } from '@/app/(app)/replays/ReplayCard';
import { tokens } from '@/app/_theme/karabuddyTokens';

// The team dashboard "hub": a full-width card grid that summarizes everything
// going on in the team without making you click through tabs. Self-fetches the
// member-gated /overview bundle (mirrors HomeTeamActivity / TeamDiscussion);
// each card deep-links to its full tab. Analytics is a separate client fetch so
// stats logic isn't duplicated and it degrades cleanly when empty.

interface OverviewData {
  counts: { tournaments: number; openReviews: number; surfacedReplays: number; members: number };
  openTournaments: { id: string; name: string; status: string; entrantCount: number }[];
  recentReplays: any[];
}
interface LeaderStat { leader: string; games: number; wins: number; winRate: number | null }

const actionLink: React.CSSProperties = {
  font: `700 11px ${tokens.led.mono}`, letterSpacing: '0.08em', color: tokens.color.accent, textDecoration: 'none', textTransform: 'uppercase',
};

export function TeamOverview({ slug }: { slug: string }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [leaders, setLeaders] = useState<LeaderStat[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/teams/${slug}/overview`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (live) setData(j); })
      .catch(() => { if (live) setError(true); });
    fetch(`/api/stats?scope=team&team=${slug}&type=leaders`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (live) setLeaders(Array.isArray(j.data) ? j.data : []); })
      .catch(() => { if (live) setLeaders([]); });
    return () => { live = false; };
  }, [slug]);

  if (error) {
    return <p style={{ color: '#a0a8b8', fontSize: 13 }}>Couldn’t load the dashboard. Try refreshing.</p>;
  }
  if (!data) return <DashboardSkeleton />;

  const { counts, openTournaments, recentReplays } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Kpi label="Members" value={counts.members} href={`/teams/${slug}?tab=members`} />
        <Kpi label="Replays" value={counts.surfacedReplays} href={`/teams/${slug}?tab=replays`} />
        <Kpi label="Open reviews" value={counts.openReviews} href={`/teams/${slug}?tab=review`} accent={counts.openReviews > 0} />
        <Kpi label="Tournaments" value={counts.tournaments} href={`/teams/${slug}?tab=tournaments`} />
      </div>

      {/* Content cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16 }}>
        {/* Tournaments */}
        <Panel accent={openTournaments.length > 0} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TacticalHeading action={<Link href={`/teams/${slug}?tab=tournaments`} style={actionLink}>View all →</Link>}>
            Tournaments
          </TacticalHeading>
          {openTournaments.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {openTournaments.map((t) => (
                <Link key={t.id} href={`/teams/${slug}?tab=tournaments`} style={rowLink}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#e6e6e6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <StatusChip status={t.status} />
                    <span style={{ fontSize: 12, color: '#8a93a3' }}>{t.entrantCount} {t.entrantCount === 1 ? 'entrant' : 'entrants'}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty>No active tournaments. Spin one up for your next event.</Empty>
          )}
        </Panel>

        {/* Reviews */}
        <Panel accent={counts.openReviews > 0} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TacticalHeading action={<Link href={`/teams/${slug}?tab=review`} style={actionLink}>View all →</Link>}>
            Reviews
          </TacticalHeading>
          {counts.openReviews > 0 ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ font: `700 38px ${tokens.led.mono}`, color: tokens.led.on, lineHeight: 1 }}>{counts.openReviews}</span>
              <span style={{ fontSize: 13, color: '#a0a8b8' }}>replay{counts.openReviews === 1 ? '' : 's'} awaiting review</span>
            </div>
          ) : (
            <Empty>All caught up — no replays are waiting on a review.</Empty>
          )}
        </Panel>

        {/* Analytics */}
        <Panel style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TacticalHeading action={<Link href={`/stats?scope=team&team=${slug}`} style={actionLink}>View all →</Link>}>
            Analytics
          </TacticalHeading>
          {leaders === null ? (
            <Empty>Loading…</Empty>
          ) : leaders.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {leaders.slice(0, 4).map((l) => (
                <div key={l.leader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, color: '#d6d6d6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.leader}</span>
                  <span style={{ fontSize: 12, color: '#8a93a3', flexShrink: 0 }}>
                    {l.games}g{l.winRate != null ? ` · ${Math.round(l.winRate * 100)}%` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No tracked games yet. Record a few and the meta shows up here.</Empty>
          )}
        </Panel>
      </div>

      {/* Recent replays — full width */}
      <section>
        <TacticalHeading action={<Link href={`/teams/${slug}?tab=replays`} style={actionLink}>View all →</Link>}>
          Recent replays
        </TacticalHeading>
        {recentReplays.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {recentReplays.map((r) => (
              <ReplayCard key={r.slug} replay={r as any} canManage={false} />
            ))}
          </div>
        ) : (
          <Panel hud={false} style={{ border: '1px dashed #2e333c', background: 'transparent', boxShadow: 'none' }}>
            <Empty>No replays surfaced to this team yet. Share or tag a game to get started.</Empty>
          </Panel>
        )}
      </section>
    </div>
  );
}

const rowLink: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '8px 10px', borderRadius: 8, textDecoration: 'none',
  background: 'rgba(255,255,255,0.025)', border: '1px solid #21262f',
};

function Kpi({ label, value, href, accent = false }: { label: string; value: number; href: string; accent?: boolean }) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <Panel hud={false} accent={accent} padding={14} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ font: `700 30px ${tokens.led.mono}`, color: accent ? tokens.led.on : '#e6e6e6', lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: 11, color: '#8a93a3', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{label}</span>
      </Panel>
    </Link>
  );
}

function StatusChip({ status }: { status: string }) {
  const live = status === 'in-progress' || status === 'active' || status === 'started';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
      padding: '2px 7px', borderRadius: 4,
      color: live ? tokens.led.on : '#8a93a3',
      background: live ? 'rgba(77,210,255,0.12)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${live ? 'rgba(77,210,255,0.3)' : '#2e333c'}`,
    }}>
      {status}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, fontSize: 13, color: '#8a93a3', lineHeight: 1.5 }}>{children}</p>;
}

function DashboardSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {[0, 1, 2, 3].map((i) => <Panel key={i} hud={false} padding={14} style={{ height: 64 }}><span /></Panel>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16 }}>
        {[0, 1, 2].map((i) => <Panel key={i} style={{ height: 140 }}><span /></Panel>)}
      </div>
    </div>
  );
}
