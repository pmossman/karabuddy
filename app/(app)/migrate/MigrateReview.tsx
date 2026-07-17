'use client';

import { useMemo, useState, type CSSProperties } from 'react';
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

function CardThumb({ card, w = 44 }: { card: CardRef; w?: number }) {
  const url = cardImageUrl(parseId(card.id), false);
  return (
    <span title={card.name ?? card.id} style={{ position: 'relative', width: w, height: Math.round(w * 1.4), flex: '0 0 auto', display: 'inline-block' }}>
      {url
        ? // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={card.name ?? card.id} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 3, display: 'block', background: tokens.color.bgDeep }} />
        : <span style={{ width: '100%', height: '100%', borderRadius: 3, border: `1px solid ${tokens.color.border}`, display: 'grid', placeItems: 'center', fontSize: 8, color: tokens.color.textMuted, textAlign: 'center', padding: 2 }}>{card.name ?? card.id}</span>}
      {card.count > 1 && <span style={{ position: 'absolute', right: -4, bottom: -5, minWidth: 15, height: 15, borderRadius: '50%', background: tokens.color.bg, border: `1px solid ${tokens.color.borderStrong}`, color: tokens.color.text, font: `700 9px ${mono}`, display: 'grid', placeItems: 'center', padding: '0 3px' }}>{card.count}</span>}
    </span>
  );
}

function DeckListView({ v }: { v: DeckVersion }) {
  const main = [...v.main].sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || (a.name ?? '').localeCompare(b.name ?? ''));
  const side = [...v.sideboard].sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99));
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ ...micro, marginBottom: 9 }}>Main deck · {v.size}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 8px' }}>{main.map((c, i) => <CardThumb key={c.id + i} card={c} />)}</div>
      {side.length > 0 && <>
        <div style={{ ...micro, margin: '16px 0 9px' }}>Sideboard · {v.sideSize}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 8px' }}>{side.map((c, i) => <CardThumb key={c.id + i} card={c} />)}</div>
      </>}
    </div>
  );
}

type Sel = { include: boolean; open: boolean };

export function MigrateReview({ decks }: { decks: DerivedDeck[] }) {
  const [sel, setSel] = useState<Sel[]>(() => decks.map(() => ({ include: true, open: false })));
  const patch = (i: number, p: Partial<Sel>) => setSel((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const chosen = useMemo(() => decks.filter((_, i) => sel[i].include), [decks, sel]);
  const games = chosen.reduce((s, d) => s + d.games, 0);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '26px 28px 64px', color: tokens.color.text, fontFamily: tokens.font.family }}>
      <div style={{ font: `600 11px ${mono}`, letterSpacing: '0.2em', textTransform: 'uppercase', color: FORGE, marginBottom: 8 }}>karabuddy → SWU Forge</div>
      <h1 style={{ fontSize: 27, margin: '0 0 10px', letterSpacing: '-0.3px', fontWeight: 700 }}>Send your decks to SWU Forge</h1>
      <p style={{ color: tokens.color.textSecondary, fontSize: 15, maxWidth: '62ch', margin: '0 0 22px' }}>
        These are the decks karabuddy found in your games — one per leader + base, most-played first. We&apos;ll send each
        deck&apos;s <b>current list</b>. Open one to see the exact cards. Uncheck any you don&apos;t want.
      </p>

      {decks.length === 0 ? (
        <Panel padding={28} style={{ textAlign: 'center', color: tokens.color.textSecondary }}>
          No constructed decks found in your games yet. Record some 50-card matches and they&apos;ll show up here.
        </Panel>
      ) : (
        <>
          <div style={{ display: 'flex', border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, overflow: 'hidden', background: tokens.color.surface, marginBottom: 18 }}>
            {[[chosen.length, 'Decks selected', FORGE], [games, 'Games behind them', tokens.led.on]].map(([v, k, c], idx) => (
              <div key={idx} style={{ flex: 1, padding: '14px 16px', borderRight: idx === 0 ? `1px solid ${tokens.color.border}` : undefined }}>
                <div style={{ font: `600 22px ${mono}`, fontVariantNumeric: 'tabular-nums', color: c as string }}>{v as number}</div>
                <div style={{ ...micro, marginTop: 2 }}>{k as string}</div>
              </div>
            ))}
          </div>

          {decks.map((deck, i) => (
            <Folder key={deck.key} deck={deck} s={sel[i]} onInclude={(on) => patch(i, { include: on })} onOpen={() => patch(i, { open: !sel[i].open })} />
          ))}

          <Footer decks={chosen.length} />
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
      <div onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', cursor: 'pointer' }}>
        <span style={{ color: tokens.color.textMuted, font: `11px ${mono}`, transform: s.open ? 'rotate(90deg)' : 'none', transition: 'transform .18s', width: 10, flex: '0 0 auto' }}>▶</span>
        <ArchThumb deck={deck} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 15.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deck.leader.name} <span style={{ color: tokens.color.textMuted, fontWeight: 400 }}>· {deck.base.label}</span>
          </div>
          <div style={{ ...micro, textTransform: 'none', letterSpacing: '0.02em', marginTop: 3, color: tokens.color.textMuted, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span><b style={{ color: tokens.color.textSecondary, fontWeight: 600 }}>{deck.games}</b> games</span>
            <span>{deck.wins}–{deck.losses}{p != null && <b style={{ color: wrColor(p), marginLeft: 5 }}>{p}%</b>}</span>
            <span>current list · {current.size}+{current.sideSize} sideboard</span>
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <LedToggle checked={s.include} onChange={onInclude} label="Send" variant="inline" />
        </div>
      </div>

      {s.open && (
        <div style={{ borderTop: `1px solid ${tokens.color.border}`, padding: '4px 16px 16px', background: 'rgba(10,8,16,0.3)' }}>
          <DeckListView v={current} />
          {deck.versions.length > 1 && (
            <div style={{ ...micro, textTransform: 'none', letterSpacing: '0.02em', marginTop: 14, color: tokens.color.textMuted }}>
              You revised this list {deck.versions.length} times between {deck.startAt} and {deck.endAt}. We send the current one;
              its earlier versions come across as the deck&apos;s history on SWU Forge.
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Footer({ decks }: { decks: number }) {
  const [done, setDone] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 26, paddingTop: 18, borderTop: `1px solid ${tokens.color.border}` }}>
      <span style={{ color: tokens.color.textMuted, font: `13px ${mono}` }}>
        {done ? `Prepared ${decks} deck${decks === 1 ? '' : 's'} for SWU Forge.` : `${decks} deck${decks === 1 ? '' : 's'} selected`}
      </span>
      <span style={{ flex: 1 }} />
      <button onClick={() => setDone(true)} disabled={decks === 0}
        style={{ ...glowButtonStyle, padding: '10px 18px', fontSize: 14, color: '#ffe7d6', border: `1px solid ${FORGE}`, boxShadow: `0 0 12px rgba(239,138,60,0.2)`, opacity: decks === 0 ? 0.4 : 1, cursor: decks === 0 ? 'not-allowed' : 'pointer' }}>
        Migrate to SWU Forge
      </button>
    </div>
  );
}
