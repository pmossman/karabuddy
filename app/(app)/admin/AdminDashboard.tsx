import type { AdminMetrics, DayPoint } from '@/lib/adminMetrics';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B157: read-only operator dashboard. Server-rendered (no interactivity yet);
// hand-rolled SVG charts mirroring the /stats surface (no chart dependency).

export function AdminDashboard({ metrics }: { metrics: AdminMetrics }) {
  const { counters: c } = metrics;
  return (
    <main style={{ maxWidth: 1040, margin: '0 auto', padding: '28px 22px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>
          Under the hood <span style={{ fontSize: 12, fontWeight: 500, color: '#6c7588', marginLeft: 6 }}>admin</span>
        </h1>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <a href="/admin/stats" style={{ color: '#5db4ff', fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>Meta stats →</a>
          <span style={{ fontSize: 11, color: '#6c7588' }}>as of {new Date(metrics.generatedAt).toLocaleString()}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 28 }}>
        <Counter label="Users" value={c.users} delta={c.usersLast7} />
        <Counter label="Games recorded" value={c.games} delta={c.gamesLast7} />
        <Counter label="Teams" value={c.teams} delta={c.teamsLast7} />
        <Counter label="Tournaments" value={c.tournaments} />
        <Counter label="Clips" value={c.clips} />
        <Counter label="Comments" value={c.tags} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 16 }}>
        <ChartCard title="New users / day" sub="last 30 days">
          <BarChart points={metrics.signupsByDay} color={tokens.color.primary} />
        </ChartCard>
        <ChartCard title="Games recorded / day" sub="last 30 days">
          <BarChart points={metrics.gamesByDay} color={tokens.led.on} />
        </ChartCard>
      </div>

      <ChartCard title="Total users" sub="cumulative, last 30 days">
        <LineChart points={metrics.cumulativeUsers} color={tokens.color.primary} />
      </ChartCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginTop: 16 }}>
        <Card title="Top teams">
          {metrics.topTeams.length === 0 ? <Empty /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {metrics.topTeams.map((t) => (
                  <tr key={t.slug} style={{ borderTop: `1px solid ${tokens.color.border}` }}>
                    <td style={{ padding: '7px 4px', fontWeight: 600 }}>{t.name}</td>
                    <td style={{ padding: '7px 4px', textAlign: 'right', color: '#a0a8b8' }}>{t.members} {t.members === 1 ? 'member' : 'members'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Recent signups">
          {metrics.recentUsers.length === 0 ? <Empty /> : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {metrics.recentUsers.map((u, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 4px', borderTop: `1px solid ${tokens.color.border}`, fontSize: 13 }}>
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || 'Unnamed'}</span>
                  <span style={{ color: '#6c7588', flex: '0 0 auto' }}>{new Date(u.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}

function Counter({ label, value, delta }: { label: string; value: number; delta?: number }) {
  return (
    <div style={{ background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.md, boxShadow: tokens.surface.panelShadow, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.15, marginTop: 4 }}>{value.toLocaleString()}</div>
      {delta != null && (
        <div style={{ fontSize: 11.5, color: delta > 0 ? '#6bd968' : '#6c7588', fontWeight: 600, marginTop: 2 }}>
          {delta > 0 ? `+${delta.toLocaleString()}` : '0'} this week
        </div>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.md, boxShadow: tokens.surface.panelShadow, padding: '14px 16px' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#d6d6d6' }}>{title}</h2>
      {children}
    </section>
  );
}

function ChartCard({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <Card title={title}>
      <div style={{ fontSize: 11, color: '#6c7588', marginTop: -6, marginBottom: 8 }}>{sub}</div>
      {children}
    </Card>
  );
}

function Empty() {
  return <div style={{ color: '#6c7588', fontSize: 12, padding: '6px 4px' }}>No data yet.</div>;
}

// --- charts (inline SVG, scale to container width) -------------------------

function BarChart({ points, color }: { points: DayPoint[]; color: string }) {
  const W = 600, H = 130, pad = 6;
  const max = Math.max(1, ...points.map((p) => p.n));
  const bw = (W - 2 * pad) / points.length;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        {points.map((p, i) => {
          const h = (p.n / max) * (H - 2 * pad);
          return (
            <rect key={i} x={pad + i * bw + 0.5} y={H - pad - h} width={Math.max(1.5, bw - 1.5)} height={Math.max(0, h)} fill={color} opacity={0.85} rx={1}>
              <title>{p.day}: {p.n}</title>
            </rect>
          );
        })}
      </svg>
      <AxisRow points={points} max={max} />
    </>
  );
}

function LineChart({ points, color }: { points: DayPoint[]; color: string }) {
  const W = 600, H = 130, pad = 6;
  const vals = points.map((p) => p.n);
  const lo = Math.min(...vals), hi = Math.max(...vals, lo + 1);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.n).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        <path d={area} fill={color} opacity={0.1} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} />
        {points.length > 0 && <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].n)} r={3} fill={color} />}
      </svg>
      <AxisRow points={points} max={hi} />
    </>
  );
}

function AxisRow({ points, max }: { points: DayPoint[]; max: number }) {
  const first = points[0]?.day, last = points[points.length - 1]?.day;
  const fmt = (d?: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#6c7588', marginTop: 4 }}>
      <span>{fmt(first)}</span>
      <span style={{ color: '#a0a8b8' }}>peak {max.toLocaleString()}</span>
      <span>{fmt(last)}</span>
    </div>
  );
}
