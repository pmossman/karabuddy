'use client';

import { useState } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import type { AdminMetrics, WeekPoint } from '@/lib/adminMetrics';

// B157 / B230-followup: internal operator dashboard. Full signup history, 90-day
// activity + active users, and per-feature adoption so we can see which features
// matter and dig into trends. Charts have labeled axes.

const PRIMARY = tokens.color?.primary ?? '#4d9dff';
const GREEN = tokens.led?.on ?? '#00E25B';
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function AdminDashboard({ metrics }: { metrics: AdminMetrics }) {
  const c = metrics.counters;
  const [win, setWin] = useState<30 | 90>(30);
  const act = metrics.activity.slice(metrics.activity.length - win);

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 24px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Under the hood</h1>
        <span style={{ fontSize: 11.5, color: '#6c7588' }}>as of {new Date(metrics.generatedAt).toLocaleString()}</span>
      </div>

      {/* Counters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, margin: '18px 0' }}>
        <Counter label="Users" value={c.users} delta={metrics.deltas.users} />
        <Counter label="Games recorded" value={c.games} delta={metrics.deltas.games} />
        <Counter label="Teams" value={c.teams} delta={metrics.deltas.teams} sub={`${c.privateTeams} private`} />
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
          <MiniChart title="Signups" points={act.map((a) => ({ x: a.day, y: a.signups }))} color="#e8c13a" kind="bar" />
        </div>
      </Card>

      {/* Feature usage */}
      <Card title="Feature usage" sub="total · last 30d · last 7d · 16-week trend">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: '#6c7588', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px', fontWeight: 700 }}>Feature</th>
              <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>Total</th>
              <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>30d</th>
              <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>7d</th>
              <th style={{ padding: '6px 8px', fontWeight: 700 }}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {[...metrics.features].sort((a, b) => b.last30 - a.last30).map((f) => (
              <tr key={f.key} style={{ borderTop: '1px solid #21262f' }}>
                <td style={{ padding: '8px', fontWeight: 600, color: '#e6ebf2' }}>{f.label}</td>
                <td style={{ padding: '8px', textAlign: 'right', color: '#c8cdd8' }}>{f.total.toLocaleString()}</td>
                <td style={{ padding: '8px', textAlign: 'right', color: f.last30 ? GREEN : '#6c7588', fontWeight: 700 }}>{f.last30.toLocaleString()}</td>
                <td style={{ padding: '8px', textAlign: 'right', color: '#8a93a3' }}>{f.last7.toLocaleString()}</td>
                <td style={{ padding: '8px', width: 140 }}><Sparkline points={f.weekly} color={PRIMARY} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Top teams + recent signups */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14, marginTop: 14 }}>
        <Card title="Most active teams" sub="by replays shared">
          {metrics.topTeams.length === 0 ? <Empty /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {metrics.topTeams.map((t) => (
                <a key={t.slug} href={`/teams/${t.slug}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', textDecoration: 'none', color: '#e6e6e6', fontSize: 13, borderRadius: 6 }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}{t.private && <span style={{ color: '#8a93a3', fontSize: 11 }}> · private</span>}</span>
                  <span style={{ color: '#8a93a3', fontSize: 11.5 }}>{t.members} members</span>
                  <span style={{ color: PRIMARY, fontWeight: 700, minWidth: 62, textAlign: 'right' }}>{t.shares.toLocaleString()} shares</span>
                </a>
              ))}
            </div>
          )}
        </Card>
        <Card title="Recent signups" sub={`${metrics.recentSignups.length} shown`}>
          {metrics.recentSignups.length === 0 ? <Empty /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {metrics.recentSignups.map((u, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 4px', fontSize: 13 }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: u.name ? '#e6e6e6' : '#6c7588' }}>{u.name ?? '(no name)'}</span>
                  <span style={{ color: '#6c7588', fontSize: 11.5 }}>{new Date(u.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}

// ── primitives ──────────────────────────────────────────────────────────────
function Counter({ label, value, delta, sub }: { label: string; value: number; delta?: number; sub?: string }) {
  return (
    <div style={{ background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#e6ebf2', marginTop: 4 }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11.5, color: '#8a93a3', marginTop: 2 }}>
        {delta != null && <span style={{ color: delta ? GREEN : '#6c7588' }}>+{delta.toLocaleString()} / 30d</span>}
        {delta != null && sub ? ' · ' : ''}{sub ?? ''}
      </div>
    </div>
  );
}
function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 800, color: muted ? '#6c7588' : '#e6ebf2' }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11, color: '#8a93a3', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
    </div>
  );
}
function Card({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: 12, padding: 16, marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#e6ebf2' }}>{title}</div>
        {sub && <div style={{ fontSize: 11.5, color: '#6c7588' }}>{sub}</div>}
        <span style={{ flex: 1 }} />
        {right}
      </div>
      {children}
    </div>
  );
}
function Empty() { return <div style={{ color: '#6c7588', fontSize: 12, padding: '6px 4px' }}>No data yet.</div>; }
function Segmented({ value, onChange, options }: { value: number; onChange: (v: number) => void; options: [number, string][] }) {
  return (
    <div style={{ display: 'inline-flex', background: '#10141b', border: '1px solid #2e333c', borderRadius: 8, padding: 2 }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} style={{ border: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 6, background: value === v ? 'rgba(77,157,255,0.15)' : 'transparent', color: value === v ? PRIMARY : '#8a93a3' }}>{l}</button>
      ))}
    </div>
  );
}
function MiniChart({ title, points, color, kind }: { title: string; points: { x: string; y: number }[]; color: string; kind: 'bar' | 'line' }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: '#a0a8b8', fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <LabeledChart points={points} color={color} kind={kind} xfmt={fmtDay} height={110} />
    </div>
  );
}

// A chart with LABELED axes: left Y ticks + gridlines, bottom X date ticks.
function LabeledChart({ points, color, kind, xfmt, yLabel, height = 150 }: { points: { x: string; y: number }[]; color: string; kind: 'bar' | 'line'; xfmt: (x: string) => string; yLabel?: string; height?: number }) {
  if (points.length === 0) return <Empty />;
  const W = 620, H = height, padL = 34, padR = 8, padT = 8, padB = 20;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(1, ...points.map((p) => p.y));
  const yticks = [0, Math.round(max / 2), max];
  const yPos = (v: number) => padT + ih - (v / max) * ih;
  const xPos = (i: number) => padL + (points.length <= 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const xIdx = points.length <= 6 ? points.map((_, i) => i) : [0, Math.floor((points.length - 1) / 2), points.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block', overflow: 'visible' }}>
      {yticks.map((v, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={yPos(v)} y2={yPos(v)} stroke="#21262f" strokeWidth={1} />
          <text x={padL - 5} y={yPos(v) + 3} textAnchor="end" fontSize={9.5} fill="#6c7588">{v.toLocaleString()}</text>
        </g>
      ))}
      {yLabel && <text x={10} y={padT + ih / 2} transform={`rotate(-90 10 ${padT + ih / 2})`} textAnchor="middle" fontSize={9} fill="#6c7588">{yLabel}</text>}
      {kind === 'bar' ? (
        points.map((p, i) => {
          const bw = Math.max(1.5, iw / points.length - 1.5);
          const h = (p.y / max) * ih;
          return <rect key={i} x={xPos(i) - bw / 2} y={padT + ih - h} width={bw} height={Math.max(0, h)} fill={color} opacity={0.85} rx={1}><title>{xfmt(p.x)}: {p.y}</title></rect>;
        })
      ) : (
        <>
          <path d={`${points.map((p, i) => `${i ? 'L' : 'M'}${xPos(i).toFixed(1)},${yPos(p.y).toFixed(1)}`).join(' ')} L${xPos(points.length - 1).toFixed(1)},${padT + ih} L${xPos(0).toFixed(1)},${padT + ih} Z`} fill={color} opacity={0.1} />
          <path d={points.map((p, i) => `${i ? 'L' : 'M'}${xPos(i).toFixed(1)},${yPos(p.y).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth={2} />
          <circle cx={xPos(points.length - 1)} cy={yPos(points[points.length - 1].y)} r={3} fill={color} />
        </>
      )}
      {xIdx.map((i) => (
        <text key={i} x={xPos(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fontSize={9.5} fill="#6c7588">{xfmt(points[i].x)}</text>
      ))}
    </svg>
  );
}

function Sparkline({ points, color }: { points: WeekPoint[]; color: string }) {
  if (points.length === 0) return <span style={{ color: '#6c7588', fontSize: 11 }}>—</span>;
  const W = 120, H = 24;
  const max = Math.max(1, ...points.map((p) => p.n));
  const x = (i: number) => (points.length <= 1 ? W / 2 : (i * W) / (points.length - 1));
  const y = (v: number) => H - 2 - (v / max) * (H - 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }}>
      <path d={points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.n).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].n)} r={2} fill={color} />
    </svg>
  );
}
