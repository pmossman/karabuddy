'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { tokens } from '@/app/_theme/karabuddyTokens';
import type { AdminMetrics } from '@/lib/adminMetrics';
import type { FeatureDetail } from '@/lib/adminDetail';
import { PRIMARY, GREEN, GOLD, MUTED, fmtDay, ago, Card, Stat, Empty, LabeledChart, MiniChart, Sparkline, RankList, pageWrap } from './ui';

// B157 / B230-followup: internal operator overview. Full signup history, 90-day
// activity + active users, per-feature adoption (rows expand to a drill-down), and
// directories of the most active teams + people that link to dedicated pages.

export function AdminDashboard({ metrics }: { metrics: AdminMetrics }) {
  const c = metrics.counters;
  const [win, setWin] = useState<30 | 90>(30);
  const act = metrics.activity.slice(metrics.activity.length - win);

  return (
    <main style={pageWrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '8px 0 4px' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Overview</h1>
        <span style={{ fontSize: 11.5, color: MUTED }}>as of {new Date(metrics.generatedAt).toLocaleString()}</span>
      </div>

      {/* Counters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, margin: '18px 0' }}>
        <Counter label="Users" value={c.users} delta={metrics.deltas.users} />
        <Counter label="Games recorded" value={c.games} delta={metrics.deltas.games} sub={`${c.recordings.toLocaleString()} recordings`} />
        <Counter label="Teams" value={c.teams} delta={metrics.deltas.teams} sub={`${c.privateTeams} private`} />
        <Counter label="Private replays" value={c.privateReplays} sub={`${c.privateTeams} private teams`} />
        <Counter label="Extension installs" value={c.installs} />
        <Counter label="Comments" value={c.comments} />
        <Counter label="Team shares" value={c.shares} />
        <Counter label="Reviews" value={c.reviews} />
        <Counter label="Clips" value={c.clips} />
        <Counter label="Tournaments" value={c.tournaments} />
        <Counter label="Opening drills" value={c.openings} />
        <Counter label="Sideboard drills" value={c.sideboards} />
      </div>

      {/* Active users */}
      <Card title="Active accounts" sub="uploaded, commented, or drilled">
        <div style={{ display: 'flex', gap: 28, padding: '4px 2px', flexWrap: 'wrap' }}>
          <Stat label="Daily (24h)" value={metrics.activeUsers.dau} />
          <Stat label="Weekly (7d)" value={metrics.activeUsers.wau} />
          <Stat label="Monthly (30d)" value={metrics.activeUsers.mau} />
          <Stat label="of total" value={metrics.counters.users} muted />
        </div>
      </Card>

      {/* Signups — all time */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 14, marginTop: 14 }}>
        <Card title="New users / week" sub="all time">
          <LabeledChart points={metrics.signupsWeekly.map((w) => ({ x: w.week, y: w.n }))} kind="bar" color={PRIMARY} xfmt={fmtDay} yLabel="signups" />
        </Card>
        <Card title="Total users" sub="cumulative, all time">
          <LabeledChart points={metrics.signupsCumulative.map((w) => ({ x: w.week, y: w.n }))} kind="line" color={PRIMARY} xfmt={fmtDay} yLabel="users" />
        </Card>
      </div>

      {/* Activity — windowed */}
      <Card title="Daily activity" sub={`last ${win} days`} right={<Segmented value={win} onChange={(v) => setWin(v as 30 | 90)} options={[[30, '30d'], [90, '90d']]} />}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
          <MiniChart title="Active accounts" points={act.map((a) => ({ x: a.day, y: a.active }))} color={GREEN} kind="line" />
          <MiniChart title="Games recorded" points={act.map((a) => ({ x: a.day, y: a.games }))} color={PRIMARY} kind="bar" />
          <MiniChart title="Signups" points={act.map((a) => ({ x: a.day, y: a.signups }))} color={GOLD} kind="bar" />
        </div>
      </Card>

      {/* Feature usage — rows expand to a drill-down */}
      <Card title="Feature usage" sub="total · last 30d · last 7d · 16-week trend — click a row to drill in">
        <FeatureTable features={metrics.features} />
      </Card>

      {/* Directories: most active teams + people, linking to detail pages */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14, marginTop: 14 }}>
        <Card title="Most active teams" sub="by replays shared" right={<Link href="/admin/teams" style={seeAll}>See all →</Link>}>
          <RankList items={metrics.topTeams.map((t) => ({
            label: t.name + (t.private ? '  · private' : ''), sub: `${t.members} members`, n: t.shares, href: `/admin/teams/${t.slug}`,
          }))} empty="No teams yet." />
        </Card>
        <Card title="Most active people" sub="by activity, last 30d" right={<Link href="/admin/users" style={seeAll}>See all →</Link>}>
          <RankList items={metrics.topUsers.map((u) => ({
            label: u.name ?? '(no name)', n: u.activity, href: `/admin/users/${u.id}`,
          }))} empty="No activity yet." />
        </Card>
      </div>

      <Card title="Recent signups" sub={`${metrics.recentSignups.length} shown`} right={<Link href="/admin/users?sort=signup" style={seeAll}>All users →</Link>}>
        {metrics.recentSignups.length === 0 ? <Empty /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {metrics.recentSignups.map((u, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 4px', fontSize: 13 }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: u.name ? '#e6e6e6' : MUTED }}>{u.name ?? '(no name)'}</span>
                <span style={{ color: MUTED, fontSize: 11.5 }}>{new Date(u.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}

const seeAll: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: PRIMARY, textDecoration: 'none' };

// ── Feature table with lazy per-row drill-down ───────────────────────────────
function FeatureTable({ features }: { features: AdminMetrics['features'] }) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...features].sort((a, b) => b.last30 - a.last30);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>
          <th style={{ padding: '6px 8px', fontWeight: 700 }}>Feature</th>
          <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>Total</th>
          <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>30d</th>
          <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>7d</th>
          <th style={{ padding: '6px 8px', fontWeight: 700 }}>Trend</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((f) => {
          const isOpen = open === f.key;
          return (
            <Fragment key={f.key}>
              <tr onClick={() => setOpen(isOpen ? null : f.key)} style={{ borderTop: '1px solid #21262f', cursor: 'pointer', background: isOpen ? 'rgba(77,157,255,0.06)' : undefined }}>
                <td style={{ padding: '8px', fontWeight: 600, color: '#e6ebf2' }}>
                  <span style={{ display: 'inline-block', width: 12, color: MUTED, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>›</span>{f.label}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', color: '#c8cdd8' }}>{f.total.toLocaleString()}</td>
                <td style={{ padding: '8px', textAlign: 'right', color: f.last30 ? GREEN : MUTED, fontWeight: 700 }}>{f.last30.toLocaleString()}</td>
                <td style={{ padding: '8px', textAlign: 'right', color: '#8a93a3' }}>{f.last7.toLocaleString()}</td>
                <td style={{ padding: '8px', width: 140 }}><Sparkline points={f.weekly} color={PRIMARY} /></td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={5} style={{ padding: 0, background: '#0d1016' }}>
                    <FeatureDrill featureKey={f.key} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function FeatureDrill({ featureKey }: { featureKey: string }) {
  const { data, loading, error } = useDetail<FeatureDetail>('feature', featureKey);
  if (loading) return <div style={{ padding: 16, color: MUTED, fontSize: 12 }}>Loading…</div>;
  if (error || !data) return <div style={{ padding: 16, color: '#e08b8b', fontSize: 12 }}>Couldn’t load detail.</div>;
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 8 }}>All-time weekly</div>
      <LabeledChart points={data.weekly.map((w) => ({ x: w.week, y: w.n }))} kind="bar" color={PRIMARY} xfmt={fmtDay} yLabel="per week" height={130} />
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))`, gap: 18, marginTop: 14 }}>
        <div>
          <ColHead>Top people</ColHead>
          <RankList items={data.topUsers.map((u) => ({ label: u.name ?? '(anon)', n: u.n, href: u.id ? `/admin/users/${u.id}` : undefined }))} />
        </div>
        {data.topTeams.length > 0 && (
          <div>
            <ColHead>Top teams</ColHead>
            <RankList items={data.topTeams.map((t) => ({ label: t.name ?? t.slug ?? '—', n: t.n, href: t.slug ? `/admin/teams/${t.slug}` : undefined }))} />
          </div>
        )}
        <div>
          <ColHead>Most recent</ColHead>
          {data.recent.length === 0 ? <Empty /> : (
            <div>
              {data.recent.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', fontSize: 12.5, borderTop: i ? '1px solid #191d25' : undefined }}>
                  <span style={{ flex: 1, color: '#cdd3dd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.actorName ?? '(anon)'}{r.team ? <span style={{ color: MUTED }}> · {r.team}</span> : null}</span>
                  <span style={{ color: MUTED, fontSize: 11 }}>{ago(r.when)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function ColHead({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>{children}</div>;
}

// Lazy fetch a drill-down bundle once its row opens (component mounts on expand).
function useDetail<T>(kind: string, id: string): { data: T | null; loading: boolean; error: boolean } {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: boolean }>({ data: null, loading: true, error: false });
  useEffect(() => {
    let live = true;
    fetch(`/api/admin/detail?kind=${kind}&id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) setState({ data: d, loading: false, error: false }); })
      .catch(() => { if (live) setState({ data: null, loading: false, error: true }); });
    return () => { live = false; };
  }, [kind, id]);
  return state;
}

// ── overview-only primitives ─────────────────────────────────────────────────
function Counter({ label, value, delta, sub }: { label: string; value: number; delta?: number; sub?: string }) {
  return (
    <div style={{ background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#e6ebf2', marginTop: 4 }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11.5, color: '#8a93a3', marginTop: 2 }}>
        {delta != null && <span style={{ color: delta ? GREEN : MUTED }}>+{delta.toLocaleString()} / 30d</span>}
        {delta != null && sub ? ' · ' : ''}{sub ?? ''}
      </div>
    </div>
  );
}
function Segmented({ value, onChange, options }: { value: number; onChange: (v: number) => void; options: [number, string][] }) {
  return (
    <div style={{ display: 'inline-flex', background: '#10141b', border: '1px solid #2e333c', borderRadius: 8, padding: 2 }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} style={{ border: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 6, background: value === v ? 'rgba(77,157,255,0.15)' : 'transparent', color: value === v ? PRIMARY : '#8a93a3' }}>{l}</button>
      ))}
    </div>
  );
}
