import Link from 'next/link';
import { tokens } from '@/app/_theme/karabuddyTokens';
import type { WeekPoint } from '@/lib/adminMetrics';

// B157-followup: shared presentational primitives for the /admin section. PURE
// (no hooks / no 'use client') so both the client overview AND the server-rendered
// detail pages import the same charts + cards. Interactive bits (search box, nav,
// window toggle) live in their own 'use client' modules.

export const PRIMARY = tokens.color?.primary ?? '#4d9dff';
export const GREEN = tokens.led?.on ?? '#00E25B';
export const GOLD = '#e8c13a';
export const MUTED = '#6c7588';

export const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '—';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  if (s < 86400 * 365) return `${Math.round(s / (86400 * 30))}mo ago`;
  return `${Math.round(s / (86400 * 365))}y ago`;
}

export function Card({ title, sub, right, children }: { title?: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: 12, padding: 16, marginTop: 14 }}>
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
          {title && <div style={{ fontSize: 14, fontWeight: 800, color: '#e6ebf2' }}>{title}</div>}
          {sub && <div style={{ fontSize: 11.5, color: MUTED }}>{sub}</div>}
          <span style={{ flex: 1 }} />
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({ label, value, muted, accent }: { label: string; value: number | string; muted?: boolean; accent?: string }) {
  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent ?? (muted ? MUTED : '#e6ebf2') }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div style={{ fontSize: 11, color: '#8a93a3', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
    </div>
  );
}

export function Empty({ label = 'No data yet.' }: { label?: string }) {
  return <div style={{ color: MUTED, fontSize: 12, padding: '6px 4px' }}>{label}</div>;
}

export function Chip({ children, href, color }: { children: React.ReactNode; href?: string; color?: string }) {
  const style: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, background: '#141922', border: '1px solid #2a3038',
    borderRadius: 999, padding: '3px 10px', fontSize: 12, color: color ?? '#cdd3dd', textDecoration: 'none', whiteSpace: 'nowrap',
  };
  return href ? <Link href={href} style={style}>{children}</Link> : <span style={style}>{children}</span>;
}

// A ranked "top N" list — [rank] label … [count]. Rows optionally link.
export function RankList({ items, empty = '—' }: { items: { label: string; sub?: string; n: number; href?: string; accent?: boolean }[]; empty?: string }) {
  if (items.length === 0) return <div style={{ color: MUTED, fontSize: 12 }}>{empty}</div>;
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', fontSize: 12.5, borderTop: i ? '1px solid #191d25' : undefined }}>
          <span style={{ color: MUTED, width: 16, textAlign: 'right', fontSize: 11 }}>{i + 1}</span>
          {it.href
            ? <Link href={it.href} style={{ flex: 1, color: '#cdd3dd', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</Link>
            : <span style={{ flex: 1, color: it.accent ? '#e6ebf2' : '#cdd3dd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>}
          {it.sub && <span style={{ color: MUTED, fontSize: 11 }}>{it.sub}</span>}
          <span style={{ color: PRIMARY, fontWeight: 700 }}>{it.n.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// A chart with LABELED axes: left Y ticks + gridlines, bottom X date ticks.
export function LabeledChart({ points, color, kind, xfmt, yLabel, height = 150 }: { points: { x: string; y: number }[]; color: string; kind: 'bar' | 'line'; xfmt: (x: string) => string; yLabel?: string; height?: number }) {
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
          <text x={padL - 5} y={yPos(v) + 3} textAnchor="end" fontSize={9.5} fill={MUTED}>{v.toLocaleString()}</text>
        </g>
      ))}
      {yLabel && <text x={10} y={padT + ih / 2} transform={`rotate(-90 10 ${padT + ih / 2})`} textAnchor="middle" fontSize={9} fill={MUTED}>{yLabel}</text>}
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
        <text key={i} x={xPos(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fontSize={9.5} fill={MUTED}>{xfmt(points[i].x)}</text>
      ))}
    </svg>
  );
}

export function MiniChart({ title, points, color, kind }: { title: string; points: { x: string; y: number }[]; color: string; kind: 'bar' | 'line' }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: '#a0a8b8', fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <LabeledChart points={points} color={color} kind={kind} xfmt={fmtDay} height={110} />
    </div>
  );
}

export function Sparkline({ points, color }: { points: WeekPoint[]; color: string }) {
  if (points.length === 0) return <span style={{ color: MUTED, fontSize: 11 }}>—</span>;
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

export const pageWrap: React.CSSProperties = { maxWidth: 1200, margin: '0 auto', padding: '20px 24px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' };
