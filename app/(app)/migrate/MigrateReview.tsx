'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { Panel } from '@/app/_components/Panel';
import { LedToggle } from '@/app/_components/LedToggle';
import { AspectIcon } from '@/app/_components/AspectIcon';
import { TacticalHeading } from '@/app/_components/TacticalHeading';
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

// ── archetype thumbnail: leader card + base (card art if unique, else aspect icon) ──
function ArchThumb({ deck }: { deck: DerivedDeck }) {
  const leaderUrl = cardImageUrl({ set: deck.leader.set ?? undefined, number: deck.leader.number ?? undefined }, true);
  const b = deck.base;
  const box: CSSProperties = { borderRadius: 4, background: tokens.color.bgDeep, display: 'block' };
  return (
    <span style={{ position: 'relative', width: 60, height: 44, flex: '0 0 auto', display: 'inline-block' }}>
      {leaderUrl
        ? // eslint-disable-next-line @next/next/no-img-element
          <img src={leaderUrl} alt={deck.leader.name} style={{ ...box, position: 'absolute', left: 0, bottom: 0, width: 44, height: 33, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.2)', boxShadow: '2px 2px 8px rgba(0,0,0,0.6)', zIndex: 1 }} />
        : <span style={{ ...box, position: 'absolute', left: 0, bottom: 0, width: 44, height: 33, border: `1px solid ${tokens.color.border}` }} />}
      <span style={{ position: 'absolute', right: 0, top: 0, width: 22, height: 22, borderRadius: '50%', background: tokens.color.bgDeep,
        border: `1px solid ${tokens.color.borderStrong}`, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        {b.art
          ? // eslint-disable-next-line @next/next/no-img-element
            <img src={cardImageUrl({ set: b.art.set, number: b.art.number }, false) ?? ''} alt={b.label} style={{ width: 30, height: 22, objectFit: 'cover' }} />
          : <AspectIcon aspect={b.iconAspect ?? b.aspect ?? 'command'} overlay={b.overlay} size={13} />}
      </span>
    </span>
  );
}

// ── one card: image + count badge ──
function CardThumb({ card, w = 46 }: { card: CardRef; w?: number }) {
  const url = cardImageUrl(parseId(card.id), false);
  return (
    <span title={card.name ?? card.id} style={{ position: 'relative', width: w, height: Math.round(w * 1.4), flex: '0 0 auto', display: 'inline-block' }}>
      {url
        ? // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={card.name ?? card.id} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 3, display: 'block', background: tokens.color.bgDeep }} />
        : <span style={{ width: '100%', height: '100%', borderRadius: 3, border: `1px solid ${tokens.color.border}`, display: 'grid', placeItems: 'center', fontSize: 8, color: tokens.color.textMuted, textAlign: 'center', padding: 2 }}>{card.name ?? card.id}</span>}
      <span style={{ position: 'absolute', right: -4, bottom: -5, minWidth: 15, height: 15, borderRadius: '50%', background: tokens.color.bg,
        border: `1px solid ${tokens.color.borderStrong}`, color: tokens.color.text, font: `700 9px ${mono}`, display: 'grid', placeItems: 'center', padding: '0 3px' }}>{card.count}</span>
    </span>
  );
}

function DeckListView({ v }: { v: DeckVersion }) {
  const main = [...v.main].sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || (a.name ?? '').localeCompare(b.name ?? ''));
  const side = [...v.sideboard].sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99));
  return (
    <div style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(10,8,16,0.4)', border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.sm }}>
      <div style={{ ...micro, marginBottom: 8 }}>Main deck · {v.size}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '11px 8px' }}>{main.map((c, i) => <CardThumb key={c.id + i} card={c} />)}</div>
      {side.length > 0 && <>
        <div style={{ ...micro, margin: '14px 0 8px' }}>Sideboard · {v.sideSize}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '11px 8px' }}>{side.map((c, i) => <CardThumb key={c.id + i} card={c} />)}</div>
      </>}
    </div>
  );
}

// ── selection state ──
type Sel = { include: boolean; open: boolean; view: number | null; versions: boolean[] };

export function MigrateReview({ decks }: { decks: DerivedDeck[] }) {
  // Default: every archetype included, but only its CURRENT (latest) list selected —
  // so it's "your decks, current lists", not a wall of 93 versions. History is opt-in.
  const [sel, setSel] = useState<Sel[]>(() =>
    decks.map((d) => ({ include: true, open: false, view: null, versions: d.versions.map((_, i) => i === d.versions.length - 1) })),
  );
  const patch = (i: number, p: Partial<Sel>) => setSel((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setVer = (i: number, vi: number, on: boolean) => setSel((s) => s.map((x, j) => (j === i ? { ...x, versions: x.versions.map((v, k) => (k === vi ? on : v)) } : x)));

  const totals = useMemo(() => {
    let a = 0, v = 0, g = 0;
    decks.forEach((d, i) => {
      if (!sel[i].include) return;
      const picked = d.versions.filter((_, vi) => sel[i].versions[vi]);
      if (!picked.length) return;
      a += 1; v += picked.length; g += picked.reduce((s, x) => s + x.games, 0);
    });
    return { a, v, g };
  }, [decks, sel]);

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '26px 28px 64px', color: tokens.color.text, fontFamily: tokens.font.family }}>
      <div style={{ font: `600 11px ${mono}`, letterSpacing: '0.2em', textTransform: 'uppercase', color: FORGE, marginBottom: 8 }}>karabuddy → SWU Forge</div>
      <h1 style={{ fontSize: 27, margin: '0 0 10px', letterSpacing: '-0.3px', fontWeight: 700 }}>Choose the decks to send to SWU Forge</h1>
      <p style={{ color: tokens.color.textSecondary, fontSize: 15, maxWidth: '64ch', margin: '0 0 22px' }}>
        One folder per deck you play (leader + base), most-played first. Each keeps only its <b>current list</b> by
        default — open a folder to include earlier versions or view the exact cards being sent.
      </p>

      {decks.length === 0 ? (
        <Panel padding={28} style={{ textAlign: 'center', color: tokens.color.textSecondary }}>
          No constructed decks found in your replays yet. Record some 50-card games and they&apos;ll show up here.
        </Panel>
      ) : (
        <>
          <StatStrip a={totals.a} v={totals.v} g={totals.g} />
          {decks.map((deck, i) => (
            <Folder key={deck.key} deck={deck} s={sel[i]}
              onInclude={(on) => patch(i, { include: on })}
              onOpen={() => patch(i, { open: !sel[i].open })}
              onView={(vi) => patch(i, { view: sel[i].view === vi ? null : vi })}
              onVer={(vi, on) => setVer(i, vi, on)} />
          ))}
          <Footer decks={totals.a} versions={totals.v} />
        </>
      )}
    </div>
  );
}

function StatStrip({ a, v, g }: { a: number; v: number; g: number }) {
  const cell = (val: number, label: string, color?: string) => (
    <div style={{ flex: 1, padding: '14px 16px', borderRight: `1px solid ${tokens.color.border}` }}>
      <div style={{ font: `600 22px ${mono}`, fontVariantNumeric: 'tabular-nums', color: color ?? tokens.color.text }}>{val}</div>
      <div style={{ ...micro, marginTop: 2 }}>{label}</div>
    </div>
  );
  return (
    <div style={{ display: 'flex', border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, overflow: 'hidden', background: tokens.color.surface, marginBottom: 18 }}>
      {cell(a, 'Decks', FORGE)}
      {cell(v, 'Lists / versions')}
      <div style={{ flex: 1, padding: '14px 16px' }}>
        <div style={{ font: `600 22px ${mono}`, fontVariantNumeric: 'tabular-nums', color: tokens.led.on }}>{g}</div>
        <div style={{ ...micro, marginTop: 2 }}>Games behind them</div>
      </div>
    </div>
  );
}

function Folder({ deck, s, onInclude, onOpen, onView, onVer }: {
  deck: DerivedDeck; s: Sel; onInclude: (on: boolean) => void; onOpen: () => void; onView: (vi: number) => void; onVer: (vi: number, on: boolean) => void;
}) {
  const p = wr(deck.wins, deck.losses);
  const picked = s.versions.filter(Boolean).length;
  const latestIdx = deck.versions.length - 1;
  return (
    <Panel hud={false} padding={0} style={{ marginBottom: 10, opacity: s.include ? 1 : 0.5, borderColor: s.include ? 'rgba(239,138,60,0.26)' : undefined }}>
      {/* folder header */}
      <div onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', cursor: 'pointer' }}>
        <span style={{ color: tokens.color.textMuted, font: `11px ${mono}`, transform: s.open ? 'rotate(90deg)' : 'none', transition: 'transform .18s', width: 10 }}>▶</span>
        <ArchThumb deck={deck} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 15.5 }}>{deck.leader.name} <span style={{ color: tokens.color.textMuted, fontWeight: 400 }}>· {deck.base.label}</span></div>
          <div style={{ ...micro, textTransform: 'none', letterSpacing: '0.02em', marginTop: 3, color: tokens.color.textMuted, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span><b style={{ color: tokens.color.textSecondary, fontWeight: 600 }}>{deck.games}</b> games</span>
            <span>{deck.wins}–{deck.losses}{p != null && <b style={{ color: wrColor(p), marginLeft: 5 }}>{p}%</b>}</span>
            <span>{deck.versions.length} version{deck.versions.length > 1 ? 's' : ''}</span>
            {s.include && <span style={{ color: FORGE }}>· sending {picked || 0}</span>}
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <LedToggle checked={s.include} onChange={onInclude} label="Include" variant="inline" />
        </div>
      </div>

      {/* expanded: the versions ("decks") */}
      {s.open && (
        <div style={{ borderTop: `1px solid ${tokens.color.border}`, padding: '12px 16px', background: 'rgba(10,8,16,0.3)' }}>
          <TacticalHeading>The lists you ran — newest first</TacticalHeading>
          {deck.versions.map((_, revIdx) => deck.versions.length - 1 - revIdx).map((vi) => {
            const v = deck.versions[vi];
            const vp = wr(v.wins, v.losses);
            const isLatest = vi === latestIdx;
            const on = s.versions[vi];
            return (
              <div key={v.label} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '9px 12px', border: `1px solid ${on ? 'rgba(239,138,60,0.3)' : tokens.color.border}`, borderRadius: tokens.radius.sm, background: tokens.color.surface, opacity: on ? 1 : 0.6 }}>
                  <span style={{ font: `700 12px ${mono}`, color: isLatest ? FORGE : tokens.color.textMuted, width: 58, flex: '0 0 auto', paddingTop: 1 }}>{isLatest ? 'CURRENT' : v.label}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: `12px ${mono}`, color: tokens.color.textSecondary }}>
                      {v.startAt}–{v.endAt} · {v.games} games · {v.wins}–{v.losses}
                      {vp != null && <span style={{ color: wrColor(vp) }}> ({vp}%)</span>}
                      <span style={{ color: tokens.color.textMuted }}> · {v.size}+{v.sideSize} sb</span>
                      <button onClick={() => onView(vi)} style={{ marginLeft: 10, background: 'none', border: 'none', color: tokens.color.accent, cursor: 'pointer', font: `12px ${mono}` }}>{s.view === vi ? 'hide cards' : 'view cards'}</button>
                    </div>
                    {v.diff && <div style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.4 }}><Diff diff={v.diff} /></div>}
                    {s.view === vi && <DeckListView v={v} />}
                  </div>
                  <LedToggle checked={on} onChange={(x) => onVer(vi, x)} label="Send" variant="inline" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function Diff({ diff }: { diff: { added: CardRef[]; removed: CardRef[] } }) {
  const chip = (c: CardRef, sign: string, color: string) => (
    <span key={sign + c.id} style={{ color, marginRight: 9, whiteSpace: 'nowrap' }}>{sign}{c.count} {c.name ?? c.id}</span>
  );
  return <span>{diff.added.map((c) => chip(c, '+', tokens.color.successText))}{diff.removed.map((c) => chip(c, '−', tokens.color.dangerSoft))}</span>;
}

function Footer({ decks, versions }: { decks: number; versions: number }) {
  const [done, setDone] = useState(false);
  const disabled = decks === 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 26, paddingTop: 18, borderTop: `1px solid ${tokens.color.border}` }}>
      <span style={{ color: tokens.color.textMuted, font: `13px ${mono}` }}>
        {done ? `Prepared ${decks} deck${decks === 1 ? '' : 's'} (${versions} list${versions === 1 ? '' : 's'}) for SWU Forge.` : `${decks} deck${decks === 1 ? '' : 's'} · ${versions} list${versions === 1 ? '' : 's'} selected`}
      </span>
      <span style={{ flex: 1 }} />
      <button onClick={() => setDone(true)} disabled={disabled}
        style={{ ...glowButtonStyle, padding: '10px 18px', fontSize: 14, color: '#ffe7d6', border: `1px solid ${FORGE}`, boxShadow: `0 0 12px rgba(239,138,60,0.2)`, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
        Migrate to SWU Forge
      </button>
    </div>
  );
}
