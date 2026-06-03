'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Frame } from '@/lib/replayDecoder';
import { analyzeResourcing, type ResourcingReport, type RegretFlag } from '@/lib/resourcingAnalysis';

// B101/Phase1: per-game, first-person resourcing report. Runs the analyzer
// client-side on the frames the viewer already decoded; only fetches card
// costs (from /api/cards). Regret flags jump to the offending frame.
interface Props {
  open: boolean;
  onClose: () => void;
  frames: Frame[] | null;
  localPlayerId: string | null;
  onJump: (frameIndex: number) => void;
}

type Catalog = Record<string, { cost: number | null; name: string | null }>;

const cidOf = (c: any): string | null => {
  const s = c?.setId;
  return s && s.set && s.set !== 'REPLAYHIDDEN' && s.number != null ? `${s.set}_${String(s.number).padStart(3, '0')}` : null;
};

export function ResourcingModal({ open, onClose, frames, localPlayerId, onJump }: Props) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  const cardIds = useMemo(() => {
    if (!frames) return [] as string[];
    const ids = new Set<string>();
    for (const f of frames) {
      for (const pid of Object.keys(f.state?.players || {})) {
        const piles = f.state.players[pid].cardPiles || {};
        for (const z of Object.keys(piles)) for (const c of piles[z] || []) { const id = cidOf(c); if (id) ids.add(id); }
      }
    }
    return [...ids];
  }, [frames]);

  useEffect(() => {
    if (!open || cardIds.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/cards?ids=${cardIds.join(',')}`);
        const body = await res.json();
        if (!cancelled && body.ok) setCatalog(body.cards);
      } catch {
        if (!cancelled) setCatalog({});
      }
    })();
    return () => { cancelled = true; };
  }, [open, cardIds]);

  const report: ResourcingReport | null = useMemo(() => {
    if (!frames || !catalog) return null;
    return analyzeResourcing(frames, { recorderId: localPlayerId, costOf: (id) => catalog[id]?.cost ?? null, nameOf: (id) => catalog[id]?.name || id });
  }, [frames, catalog, localPlayerId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;
  const jump = (i: number) => { onJump(i); onClose(); };
  // Severity-sort flags: buried (a missed play) first, then clogs by how much was floated.
  const flags = report ? [...report.flags].sort((a, b) => rank(b) - rank(a)) : [];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div role="dialog" aria-modal="true" aria-label="Resourcing report" onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(760px, 95vw)', maxHeight: '90vh', background: '#11141a', border: '1px solid #2e333c', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #2e333c' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4dd2ff' }}>Resourcing</span>
            {report?.username && <span style={{ fontSize: 13, color: '#a0a8b8' }}>{report.username}</span>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 0, color: '#a0a8b8', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 0, width: 28, height: 28 }}>×</button>
        </header>

        <div style={{ overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {!report ? (
            <div style={{ color: '#6c7588', fontStyle: 'italic', padding: '24px 0', textAlign: 'center' }}>Analyzing resourcing…</div>
          ) : (
            <>
              {/* Summary */}
              <section style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <Stat label="Floated total" value={String(report.floatTotal)} />
                <Stat label="Forced" value={String(report.floatByReason.forced)} tone="warn" />
                <Stat label="Underspend" value={String(report.floatByReason.underspend)} tone="warn" />
                <Stat label="Initiative (ok)" value={String(report.floatByReason.initiative)} tone="muted" />
              </section>

              {/* Regret flags — the highlight */}
              <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SectionTitle>Resource regret ({flags.length})</SectionTitle>
                {flags.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#6bd968' }}>No major resourcing regrets — your floats were forced or intentional. Nicely done.</div>
                ) : (
                  flags.map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 6, background: 'rgba(224,198,74,0.06)', border: `1px solid ${f.kind === 'buried' ? 'rgba(255,122,122,0.4)' : 'rgba(224,198,74,0.35)'}` }}>
                      <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: f.kind === 'buried' ? '#ff7a7a' : '#e0c64a', flex: '0 0 auto', paddingTop: 2 }}>{f.kind}</span>
                      <span style={{ fontSize: 13, lineHeight: 1.4, flex: 1 }}>{f.message}</span>
                      <button type="button" onClick={() => jump(f.frameIndex)} style={{ flex: '0 0 auto', background: 'rgba(77,157,255,0.15)', border: '1px solid rgba(77,157,255,0.4)', color: '#a7d2ff', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>→ R{f.round}</button>
                    </div>
                  ))
                )}
              </section>

              {/* Round timeline */}
              <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <SectionTitle>Round-by-round</SectionTitle>
                {report.rounds.map((r) => (
                  <button key={r.round} type="button" onClick={() => jump(r.endFrameIndex)}
                    style={{ display: 'flex', gap: 8, alignItems: 'baseline', textAlign: 'left', background: 'transparent', border: 0, borderBottom: '1px solid #1c2128', padding: '5px 2px', cursor: 'pointer', color: '#cfd6e0', fontFamily: 'inherit', fontSize: 12 }}>
                    <span style={{ flex: '0 0 32px', color: '#6c7588', fontWeight: 700 }}>R{r.round}</span>
                    <span style={{ flex: '0 0 120px', color: r.float > 0 && r.reason !== 'initiative' && !r.isFinal ? '#e0c64a' : '#6c7588' }}>
                      {r.float > 0 ? `floated ${r.float}/${r.resources}` : `spent (${r.resources})`}
                    </span>
                    <span style={{ flex: '0 0 90px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6c7588' }}>{r.isFinal ? 'final' : r.reason}</span>
                    <span style={{ flex: 1, color: '#a0a8b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.plays.length ? `▸ ${r.plays.map(nm(catalog)).join(', ')}` : ''}{r.resourced.length ? `  ⛁ ${r.resourced.map(nm(catalog)).join(', ')}` : ''}
                    </span>
                  </button>
                ))}
              </section>

              {report.deadCards.length > 0 && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <SectionTitle>Drawn but never played ({report.deadCards.length})</SectionTitle>
                  <div style={{ fontSize: 12, color: '#a0a8b8', lineHeight: 1.5 }}>{report.deadCards.map((d) => (catalog?.[d.cardId]?.name || d.cardId)).join(' · ')}</div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const rank = (f: RegretFlag) => (f.kind === 'buried' ? 1000 + f.float : (f as any).floatedWhileHeld || 0);
const nm = (cat: Catalog | null) => (id: string) => cat?.[id]?.name || id;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6c7588' }}>{children}</div>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'muted' }) {
  const color = tone === 'warn' ? '#e0c64a' : tone === 'muted' ? '#6c7588' : '#4dd2ff';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '6px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid #2e333c', minWidth: 84 }}>
      <span style={{ fontSize: 18, fontWeight: 800, color }}>{value}</span>
      <span style={{ fontSize: 10, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
    </div>
  );
}
