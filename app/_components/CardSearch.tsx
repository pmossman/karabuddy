'use client';

import { useEffect, useRef, useState } from 'react';

// B226: card-name autocomplete for the team Replays card finder. Free-text →
// debounced /api/cards?q= search → pick a card. Same popover interaction
// contract as the other filter controls (outside-click + Esc close).

interface CardHit { cardId: string; name: string; subtitle: string | null; type: string | null; aspects: string[] | null }
export interface SelectedCard { cardId: string; name: string; subtitle: string | null }

const cardLabel = (c: { name: string; subtitle: string | null }) => (c.subtitle ? `${c.name} · ${c.subtitle}` : c.name);

export function CardSearch({ value, onChange, testId }: { value: SelectedCard | null; onChange: (c: SelectedCard | null) => void; testId?: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CardHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setHits([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cards?q=${encodeURIComponent(term)}`);
        const j = await res.json();
        setHits(j.ok && Array.isArray(j.results) ? j.results : []);
      } catch { setHits([]); }
      finally { setLoading(false); }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (h: CardHit) => { onChange({ cardId: h.cardId, name: h.name, subtitle: h.subtitle }); setQ(''); setHits([]); setOpen(false); };

  // Selected → a clearable chip.
  if (value) {
    return (
      <span data-testid={testId} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 12px', background: 'rgba(77,210,255,0.10)', border: '1px solid rgba(77,210,255,0.45)', borderRadius: 8, color: '#cfe4ff', fontSize: 13, fontWeight: 600 }}>
        <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cardLabel(value)}</span>
        <button type="button" aria-label="Clear card filter" data-testid={testId ? `${testId}-clear` : undefined} onClick={() => onChange(null)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 999, border: 0, background: 'rgba(255,255,255,0.12)', color: '#cfe4ff', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>×</button>
      </span>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <input
        type="search"
        value={q}
        data-testid={testId}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Find a card…"
        style={{ background: '#11141a', color: '#e6e6e6', border: `1px solid ${open ? '#4d9dff' : '#2e333c'}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', minWidth: 180 }}
      />
      {open && q.trim() && (
        <div role="listbox" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 60, minWidth: 240, maxHeight: 300, overflowY: 'auto', background: '#1a1d24', border: '1px solid #2e333c', borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.55)', padding: 4 }}>
          {loading && hits.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12.5, color: '#6c7588' }}>Searching…</div>}
          {!loading && hits.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12.5, color: '#6c7588' }}>No cards match.</div>}
          {hits.map((h) => (
            <button
              key={h.cardId}
              type="button"
              data-testid="card-search-hit"
              onClick={() => pick(h)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'transparent', border: 0, borderRadius: 6, color: '#e6e6e6', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {h.name}
              {h.subtitle && <span style={{ color: '#8a93a3' }}> · {h.subtitle}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
