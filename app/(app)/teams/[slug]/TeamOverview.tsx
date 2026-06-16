'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Panel } from '@/app/_components/Panel';
import { TacticalHeading } from '@/app/_components/TacticalHeading';
import { ReplayCard } from '@/app/(app)/replays/ReplayCard';
import { tokens } from '@/app/_theme/karabuddyTokens';

// The team dashboard "hub": one section per feature (Members, Tournaments,
// Reviews, Team Replays) so you get a real summary of what's going on without
// clicking through tabs. Self-fetches the member-gated /overview bundle; each
// section deep-links to its full tab.

interface Member { userId: string; role: string; name: string | null; image: string | null }
interface Tourney { id: string; name: string; status: string; entrantCount: number }
interface OverviewData {
  counts: { tournaments: number; openReviews: number; surfacedReplays: number; members: number };
  members: Member[];
  openTournaments: Tourney[];
  reviewReplays: any[];
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

  const { counts, members, openTournaments, reviewReplays, recentReplays } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16, alignItems: 'start' }}>
        {/* Members */}
        <Panel style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TacticalHeading action={<Link href={`/teams/${slug}?tab=members`} style={actionLink}>View all →</Link>}>
            Members · {counts.members}
          </TacticalHeading>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {members.map((m) => (
              <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px 5px 5px', borderRadius: 999, background: 'rgba(255,255,255,0.03)', border: '1px solid #21262f' }}>
                <Avatar name={m.name} image={m.image} size={22} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#d6d6d6' }}>{m.name || 'Unnamed'}</span>
                {m.role === 'owner' && <span style={{ fontSize: 9, fontWeight: 700, color: '#5db4ff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Owner</span>}
              </div>
            ))}
          </div>
        </Panel>

        {/* Tournaments */}
        <Panel accent={openTournaments.length > 0} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TacticalHeading action={<Link href={`/teams/${slug}?tab=tournaments`} style={actionLink}>View all →</Link>}>
            Tournaments{counts.tournaments > 0 ? ` · ${counts.tournaments}` : ''}
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
            Reviews{counts.openReviews > 0 ? ` · ${counts.openReviews}` : ''}
          </TacticalHeading>
          {reviewReplays.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {reviewReplays.map((r) => (
                <Link key={r.slug} href={`/r/${r.slug}`} style={rowLink}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#e6e6e6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{replayLabel(r)}</span>
                  <span style={{ fontSize: 11, color: '#8a93a3', flexShrink: 0 }}>
                    {r.requestedByName ? `${r.requestedByName} · ` : ''}{timeAgo(r.requestedAt)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty>All caught up — no replays are waiting on a review.</Empty>
          )}
        </Panel>
      </div>

      {/* Team Replays — full width */}
      <section>
        <TacticalHeading action={<Link href={`/teams/${slug}?tab=replays`} style={actionLink}>View all →</Link>}>
          Team replays{counts.surfacedReplays > 0 ? ` · ${counts.surfacedReplays}` : ''}
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
      padding: '2px 7px', borderRadius: 4,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {[0, 1, 2].map((i) => <Panel key={i} style={{ height: 150 }}><span /></Panel>)}
      </div>
      <Panel hud={false} style={{ height: 120, border: '1px dashed #2e333c', background: 'transparent', boxShadow: 'none' }}><span /></Panel>
    </div>
  );
}
