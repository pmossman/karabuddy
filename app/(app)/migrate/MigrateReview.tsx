'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Panel } from '@/app/_components/Panel';
import { LedToggle } from '@/app/_components/LedToggle';
import { AspectIcon } from '@/app/_components/AspectIcon';
import { glowButtonStyle } from '@/app/_components/glowButton';
import { cardImageUrl } from '@/lib/cardImage';
import { tokens } from '@/app/_theme/karabuddyTokens';
import type { DerivedDeck, DeckVersion, CardRef } from '@/lib/deckVersions';

const FORGE = '#ef8a3c';
const mono = tokens.led.mono;
const micro: CSSProperties = { font: `600 10px ${mono}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: tokens.color.textMuted };
const wrColor = (p: number) => (p >= 55 ? tokens.color.successText : p >= 45 ? tokens.color.warn : tokens.color.dangerSoft);
const wr = (w: number, l: number) => (w + l ? Math.round((w / (w + l)) * 100) : null);
const parseId = (id: string) => { const i = id.lastIndexOf('_'); return { set: id.slice(0, i), number: Number(id.slice(i + 1)) }; };

// archetype thumbnail: leader card + base (card art if unique, else aspect icon)
function ArchThumb({ deck }: { deck: DerivedDeck }) {
  const leaderUrl = cardImageUrl({ set: deck.leader.set ?? undefined, number: deck.leader.number ?? undefined }, true);
  const b = deck.base;
  return (
    <span style={{ position: 'relative', width: 58, height: 40, flex: '0 0 auto', display: 'inline-block' }}>
      {leaderUrl
        ? // eslint-disable-next-line @next/next/no-img-element
          <img src={leaderUrl} alt={deck.leader.name} style={{ position: 'absolute', left: 0, bottom: 0, width: 42, height: 31, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(255,255,255,0.2)', boxShadow: '2px 2px 8px rgba(0,0,0,0.6)', zIndex: 1, background: tokens.color.bgDeep }} />
        : <span style={{ position: 'absolute', left: 0, bottom: 0, width: 42, height: 31, borderRadius: 4, border: `1px solid ${tokens.color.border}` }} />}
      <span style={{ position: 'absolute', right: 0, top: 0, width: 22, height: 22, borderRadius: '50%', background: tokens.color.bgDeep, border: `1px solid ${tokens.color.borderStrong}`, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        {b.art
          ? // eslint-disable-next-line @next/next/no-img-element
            <img src={cardImageUrl({ set: b.art.set, number: b.art.number }, false) ?? ''} alt={b.label} style={{ width: 30, height: 22, objectFit: 'cover' }} />
          : <AspectIcon aspect={b.iconAspect ?? b.aspect ?? 'command'} overlay={b.overlay} size={13} />}
      </span>
    </span>
  );
}

const HOVER_DELAY = 400; // ms the cursor must rest before the preview shows

function CardThumb({ card, w = 44, tone }: { card: CardRef; w?: number; tone?: 'added' | 'removed' }) {
  const url = cardImageUrl(parseId(card.id), false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const posRef = useRef({ x: 0, y: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const start = (e: React.MouseEvent) => {
    posRef.current = { x: e.clientX, y: e.clientY };
    if (timer.current) clearTimeout(timer.current);
    // only show once the cursor has actually rested here — sweeping across cards
    // leaves before the delay fires, so nothing flashes.
    timer.current = setTimeout(() => setAnchor({ ...posRef.current }), HOVER_DELAY);
  };
  const stop = () => { if (timer.current) clearTimeout(timer.current); setAnchor(null); };
  const PW = 236, PH = Math.round(PW / 0.716); // full-card aspect
  const place = anchor && typeof window !== 'undefined'
    ? { left: Math.min(anchor.x + 20, window.innerWidth - PW - 10), top: Math.min(Math.max(anchor.y - PH / 2, 8), window.innerHeight - PH - 8) }
    : null;
  const ring: CSSProperties = tone === 'added' ? { border: `1.5px solid ${tokens.color.success}`, boxShadow: `0 0 0 2px rgba(107,217,104,0.4)` }
    : tone === 'removed' ? { border: `1.5px solid ${tokens.color.danger}` } : {};
  return (
    <span onMouseEnter={start} onMouseMove={(e) => { posRef.current = { x: e.clientX, y: e.clientY }; }} onMouseLeave={stop}
      style={{ position: 'relative', width: w, height: Math.round(w * 1.4), flex: '0 0 auto', display: 'inline-block', opacity: tone === 'removed' ? 0.5 : 1 }}>
      {url
        ? // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={card.name ?? card.id} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 3, display: 'block', background: tokens.color.bgDeep, ...ring }} />
        : <span style={{ width: '100%', height: '100%', borderRadius: 3, border: `1px solid ${tokens.color.border}`, display: 'grid', placeItems: 'center', fontSize: 8, color: tokens.color.textMuted, textAlign: 'center', padding: 2, ...ring }}>{card.name ?? card.id}</span>}
      {card.count > 1 && <span style={{ position: 'absolute', right: -4, bottom: -5, minWidth: 15, height: 15, borderRadius: '50%', background: tokens.color.bg, border: `1px solid ${tokens.color.borderStrong}`, color: tokens.color.text, font: `700 9px ${mono}`, display: 'grid', placeItems: 'center', padding: '0 3px' }}>{card.count}</span>}
      {place && // eslint-disable-next-line @next/next/no-img-element
        <img src={url!} alt="" style={{ position: 'fixed', left: place.left, top: place.top, width: PW, height: PH, borderRadius: 10, boxShadow: '0 10px 34px rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.16)', zIndex: 1000, pointerEvents: 'none' }} />}
    </span>
  );
}

function DeckListView({ v, addedIds }: { v: DeckVersion; addedIds?: Set<string> }) {
  const main = [...v.main].sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || (a.name ?? '').localeCompare(b.name ?? ''));
  const side = [...v.sideboard].sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99));
  const tone = (c: CardRef): 'added' | undefined => (addedIds?.has(c.id) ? 'added' : undefined);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ ...micro, marginBottom: 9 }}>Main deck · {v.size}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 8px' }}>{main.map((c, i) => <CardThumb key={c.id + i} card={c} tone={tone(c)} />)}</div>
      {side.length > 0 && <>
        <div style={{ ...micro, margin: '16px 0 9px' }}>Sideboard · {v.sideSize}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 8px' }}>{side.map((c, i) => <CardThumb key={c.id + i} card={c} tone={tone(c)} />)}</div>
      </>}
    </div>
  );
}

function NavBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return <button onClick={onClick} disabled={disabled} aria-label={label === '◀' ? 'previous version' : 'next version'}
    style={{ background: tokens.color.surface, border: `1px solid ${tokens.color.borderStrong}`, color: disabled ? tokens.color.textFaint : tokens.color.text, borderRadius: 6, width: 26, height: 24, cursor: disabled ? 'default' : 'pointer', font: `12px ${mono}`, flex: '0 0 auto' }}>{label}</button>;
}

// Scrub through a deck's versions (latest → earliest) with ◀▶ / arrow keys / dots.
// Added cards ring green; cut cards show faded — so you see how it evolved.
function VersionScrubber({ deck }: { deck: DerivedDeck }) {
  const last = deck.versions.length - 1;
  const [vi, setVi] = useState(last);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  const v = deck.versions[vi];
  const isLatest = vi === last;
  const p = wr(v.wins, v.losses);
  const addedIds = new Set((v.diff?.added ?? []).map((c) => c.id));
  const go = (d: number) => setVi((x) => Math.max(0, Math.min(last, x + d)));
  const single = deck.versions.length === 1;
  return (
    <div ref={ref} tabIndex={0} onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } }} style={{ outline: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
        {!single && <NavBtn label="◀" onClick={() => go(-1)} disabled={vi === 0} />}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ font: `700 11px ${mono}`, letterSpacing: '0.08em', color: isLatest ? FORGE : tokens.color.textSecondary }}>{isLatest ? 'CURRENT LIST' : v.label.toUpperCase()}</span>
          <span style={{ ...micro, textTransform: 'none', letterSpacing: '0.02em', marginLeft: 10 }}>{v.startAt}–{v.endAt} · {v.games} games · {v.wins}–{v.losses}{p != null ? ` (${p}%)` : ''}</span>
        </div>
        {!single && <><span style={{ font: `11px ${mono}`, color: tokens.color.textMuted }}>{vi + 1}/{deck.versions.length}</span><NavBtn label="▶" onClick={() => go(1)} disabled={vi === last} /></>}
      </div>
      {!single && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '9px 0 4px', flexWrap: 'wrap' }}>
          {deck.versions.map((_, k) => (
            <button key={k} onClick={() => setVi(k)} title={deck.versions[k].label} aria-label={`version ${k + 1}`}
              style={{ width: k === vi ? 20 : 8, height: 8, borderRadius: 4, border: 'none', padding: 0, cursor: 'pointer', transition: 'width .12s',
                background: k === vi ? FORGE : k === last ? 'rgba(239,138,60,0.45)' : tokens.color.borderStrong }} />
          ))}
          <span style={{ ...micro, textTransform: 'none', marginLeft: 6, color: tokens.color.textFaint }}>← → to step</span>
        </div>
      )}
      {v.diff && v.diff.removed.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ ...micro, marginBottom: 8, color: tokens.color.dangerSoft }}>Cut going into {v.label}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 8px' }}>{v.diff.removed.map((c, i) => <CardThumb key={c.id + i} card={c} tone="removed" />)}</div>
        </div>
      )}
      <DeckListView v={v} addedIds={addedIds} />
    </div>
  );
}

type Sel = { include: boolean; open: boolean };

export function MigrateReview({ decks }: { decks: DerivedDeck[] }) {
  const [sel, setSel] = useState<Sel[]>(() => decks.map(() => ({ include: true, open: false })));
  const patch = (i: number, p: Partial<Sel>) => setSel((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const chosen = useMemo(() => decks.filter((_, i) => sel[i].include), [decks, sel]);
  const games = chosen.reduce((s, d) => s + d.games, 0);
  const allOn = chosen.length === decks.length;
  const setAll = (on: boolean) => setSel((s) => s.map((x) => ({ ...x, include: on })));

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '26px 28px 64px', color: tokens.color.text, fontFamily: tokens.font.family }}>
      <div style={{ font: `600 11px ${mono}`, letterSpacing: '0.2em', textTransform: 'uppercase', color: FORGE, marginBottom: 8 }}>karabuddy → SWU Forge</div>
      <h1 style={{ fontSize: 27, margin: '0 0 6px', letterSpacing: '-0.3px', fontWeight: 700 }}>Send your decks to SWU Forge</h1>
      <p style={{ color: tokens.color.textMuted, fontSize: 13, margin: '0 0 20px' }}>From your replays · most-played first · current list of each</p>

      {decks.length === 0 ? (
        <Panel padding={28} style={{ textAlign: 'center', color: tokens.color.textSecondary }}>
          No constructed decks found in your games yet. Record some 50-card matches and they&apos;ll show up here.
        </Panel>
      ) : (
        <>
          <ActionBar chosen={chosen} total={decks.length} games={games} allOn={allOn} onToggleAll={() => setAll(!allOn)} />

          {decks.map((deck, i) => (
            <Folder key={deck.key} deck={deck} s={sel[i]} onInclude={(on) => patch(i, { include: on })} onOpen={() => patch(i, { open: !sel[i].open })} />
          ))}
        </>
      )}
    </div>
  );
}

function Folder({ deck, s, onInclude, onOpen }: { deck: DerivedDeck; s: Sel; onInclude: (on: boolean) => void; onOpen: () => void }) {
  const p = wr(deck.wins, deck.losses);
  const current = deck.versions[deck.versions.length - 1];
  return (
    <Panel hud={false} padding={0} style={{ marginBottom: 10, opacity: s.include ? 1 : 0.5, borderColor: s.include ? 'rgba(239,138,60,0.26)' : undefined }}>
      <div onClick={() => onInclude(!s.include)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}>
        <button onClick={(e) => { e.stopPropagation(); onOpen(); }} aria-label={s.open ? 'Hide cards' : 'Show cards'} title={s.open ? 'Hide cards' : 'Show cards'}
          style={{ background: s.open ? 'rgba(239,138,60,0.14)' : 'transparent', border: `1px solid ${s.open ? 'rgba(239,138,60,0.4)' : tokens.color.border}`, borderRadius: 6, color: tokens.color.textSecondary, width: 24, height: 24, display: 'grid', placeItems: 'center', cursor: 'pointer', flex: '0 0 auto', padding: 0, transition: 'background .15s, border-color .15s' }}>
          <span style={{ font: `10px ${mono}`, lineHeight: 1, transform: s.open ? 'rotate(90deg)' : 'none', transition: 'transform .18s' }}>▶</span>
        </button>
        <ArchThumb deck={deck} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 15.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deck.leader.name} <span style={{ color: tokens.color.textMuted, fontWeight: 400 }}>· {deck.base.label}</span>
          </div>
          <div style={{ ...micro, textTransform: 'none', letterSpacing: '0.02em', marginTop: 3, color: tokens.color.textMuted, display: 'flex', gap: 12, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
            <span><b style={{ color: tokens.color.textSecondary, fontWeight: 600 }}>{deck.games}</b> games</span>
            <span>{deck.wins}–{deck.losses}{p != null && <b style={{ color: wrColor(p), marginLeft: 5 }}>{p}%</b>}</span>
            <span>{current.size}+{current.sideSize}</span>
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <LedToggle checked={s.include} onChange={onInclude} label="Send" variant="inline" />
        </div>
      </div>

      {s.open && (
        <div style={{ borderTop: `1px solid ${tokens.color.border}`, padding: '4px 16px 16px', background: 'rgba(10,8,16,0.3)' }}>
          <VersionScrubber deck={deck} />
        </div>
      )}
    </Panel>
  );
}

const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', color: tokens.led.on, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 };

// The page's primary action, pinned to the top so it's visible without scrolling.
function ActionBar({ chosen, total, games, allOn, onToggleAll }: { chosen: DerivedDeck[]; total: number; games: number; allOn: boolean; onToggleAll: () => void }) {
  const n = chosen.length;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Live creation into SWU Forge is CORS/auth-blocked from our origin — it needs a
  // SWU Forge-side handoff (Andy). Until that lands, this honestly confirms the
  // selection is prepared rather than faking a push. The real POST slots in here.
  const onMigrate = async () => {
    setBusy(true); setResult(null);
    try {
      await new Promise((r) => setTimeout(r, 250));
      setResult({ ok: true, msg: `${n} deck${n === 1 ? '' : 's'} ready. Live SWU Forge creation is the pending handoff — wiring it with Andy next.` });
    } finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 6, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 18px', borderRadius: tokens.radius.md, border: '1px solid rgba(239,138,60,0.32)', background: 'rgba(14,11,20,0.94)', backdropFilter: 'blur(8px)', boxShadow: '0 6px 22px rgba(0,0,0,0.4)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.2px' }}>
            Create <span style={{ color: FORGE, fontVariantNumeric: 'tabular-nums' }}>{n}</span> deck{n === 1 ? '' : 's'} in SWU Forge
          </div>
          <div style={{ ...micro, textTransform: 'none', letterSpacing: '0.02em', marginTop: 3, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
            <span>{games} games behind them</span>
            <span aria-hidden>·</span>
            <button onClick={onToggleAll} style={linkBtn}>{allOn ? 'Deselect all' : `Select all ${total}`}</button>
          </div>
        </div>
        <button onClick={onMigrate} disabled={n === 0 || busy}
          style={{ ...glowButtonStyle, padding: '11px 20px', fontSize: 14, fontWeight: 650, color: '#ffe7d6', border: `1px solid ${FORGE}`, background: 'rgba(239,138,60,0.16)', boxShadow: '0 0 14px rgba(239,138,60,0.25)', opacity: n === 0 || busy ? 0.45 : 1, cursor: n === 0 || busy ? 'not-allowed' : 'pointer', flex: '0 0 auto' }}>
          {busy ? 'Migrating…' : 'Migrate →'}
        </button>
      </div>
      {result && (
        <div style={{ ...micro, textTransform: 'none', letterSpacing: '0.02em', marginTop: 8, paddingLeft: 4, color: result.ok ? tokens.color.successText : tokens.color.dangerSoft }}>
          {result.ok ? '✓ ' : '✕ '}{result.msg}
        </div>
      )}
    </div>
  );
}
