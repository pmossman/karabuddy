'use client';

// B42: render captured deck snapshots from a replay's lobbyState capture.
// Local player has full leader/base/deck/sideboard; opponent typically
// only has leader/base (karabast masks the rest). Cards are grouped by
// card-cost so the layout reads more like a deckbuilder list.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { cardImageUrl } from '@/lib/cardImage';
import { useMediaQuery } from '@/lib/useMediaQuery';
import type { UserDeck, DeckCardRef } from '@/lib/replayDecoder';

// B208: "Fit all" geometry. Cards are portrait (~0.71 w/h); we want the LARGEST
// uniform card width such that every section's rows fit the available height —
// then balance each row's length. GAP/BADGE match the grid below.
const GAP = 6;
const CARD_ASPECT = 1 / 0.71; // height / width
const BADGE_OVERHANG = 20; // count badge (a circle) hangs ~half its height below the card
const SECTION_LABEL_H = 28; // each section's <h3> + its gap

// Largest card width (px) so all `counts` sections' rows fit within `availH` at
// container width `W`. Steps down from a sane max so few-card decks don't balloon.
function solveFitWidth(W: number, availH: number, counts: number[]): number {
  for (let cw = 210; cw >= 40; cw -= 1) {
    const cols = Math.max(1, Math.floor((W + GAP) / (cw + GAP)));
    const cardH = cw * CARD_ASPECT + BADGE_OVERHANG;
    let h = 0;
    for (const n of counts) if (n > 0) h += SECTION_LABEL_H + Math.ceil(n / cols) * (cardH + GAP);
    if (h <= availH) return cw;
  }
  return 40;
}

// Fewest columns that keeps the same row count at width `cw` — so the last row
// isn't a lonely stub (minimizes the difference in row lengths).
function balancedCols(W: number, cw: number, n: number): number {
  const maxCols = Math.max(1, Math.floor((W + GAP) / (cw + GAP)));
  const rows = Math.max(1, Math.ceil(n / maxCols));
  return Math.max(1, Math.ceil(n / rows));
}

export function DeckBlock({ deck, isLocal, fullPageHref, seenCards }: { deck: UserDeck; isLocal: boolean; fullPageHref: string | null; seenCards?: DeckCardRef[] }) {
  const hasFullDeck = Array.isArray(deck.deck) && deck.deck.length > 0;
  const totalMain = hasFullDeck ? sumCounts(deck.deck!) : null;
  const totalSide = deck.sideboard ? sumCounts(deck.sideboard) : 0;
  // Opponent decks have no full list (karabast masks it). When DecksModal passes
  // the "seen during play" cards, render THOSE as the main grid so the opponent
  // view uses the exact same fit-to-screen solver + 2-column layout as your deck.
  const showSeen = !hasFullDeck && Array.isArray(seenCards) && seenCards.length > 0;
  const mainCards: DeckCardRef[] | null = hasFullDeck ? deck.deck! : (showSeen ? seenCards! : null);
  const mainTitle = hasFullDeck ? 'Main deck' : `Seen during play (${seenCards?.length ?? 0} unique)`;
  const mainCount = mainCards ? mainCards.length : 0;
  const sideCount = totalSide > 0 && deck.sideboard ? deck.sideboard.length : 0;

  // B208: "Fit all" (default) sizes cards as LARGE as possible so the whole deck
  // fits on screen with balanced rows. "Larger" zooms in (scrolls) for reading.
  const [fit, setFit] = useState(true);
  const ref = useRef<HTMLElement>(null);
  const [box, setBox] = useState<{ w: number; vh: number } | null>(null);
  useEffect(() => {
    if (!fit) { setBox(null); return; }
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      setBox({ w: el.clientWidth, vh: window.innerHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && ref.current) ro.observe(ref.current);
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [fit, mainCount, sideCount]);

  // B208b: when there's horizontal room, tuck leaders + sideboard into a narrow
  // LEFT column and let the MAIN deck fill the big right area (solved to the full
  // column height → much larger cards, less dead space). Otherwise stack + solve
  // as one block. "Larger" mode (fit=false) always stacks + scrolls.
  const LEFT_W = 264;
  const COL_GAP = 16;
  const LEADERS_H = 150; // leaders row height reserved atop the left column
  const twoCol = fit && !!box && box.w > 900 && mainCount > 0;
  // Target the modal's MAX height (95vh cap) derived from the viewport — NOT the
  // current modal bottom. The modal is content-height up to its cap, so measuring
  // it makes the cards + the modal chase each other downward and settle SMALLER
  // than the cap allows. MODAL_CHROME = header + body padding + deck header +
  // bottom padding (generous so content never exceeds the cap → no scroll).
  const MODAL_CHROME = 140;
  const colH = box ? Math.max(220, box.vh * 0.95 - MODAL_CHROME) : 0;
  const mainW = twoCol ? box!.w - LEFT_W - COL_GAP : (box?.w ?? 0);
  let mainFitW: number | null = null;
  let sideFitW: number | null = null;
  if (fit && box) {
    if (twoCol) {
      mainFitW = solveFitWidth(mainW, colH, [mainCount]);
      sideFitW = sideCount > 0 ? solveFitWidth(LEFT_W, Math.max(140, colH - LEADERS_H), [sideCount]) : null;
    } else {
      mainFitW = solveFitWidth(box.w, Math.max(180, colH - LEADERS_H), [mainCount, sideCount].filter((n) => n > 0));
      sideFitW = mainFitW;
    }
  }

  return (
    <section ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#e6e6e6' }}>
          {deck.username || 'Unknown player'}
        </span>
        {isLocal && (
          <span style={{ fontSize: 10, color: '#5db4ff', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
            You
          </span>
        )}
        {hasFullDeck ? (
          <span style={{ fontSize: 11, color: '#6c7588' }}>
            {totalMain} cards{totalSide > 0 ? ` · ${totalSide} side` : ''}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: '#e0c64a', fontStyle: 'italic' }}>
            Full list not available (karabast doesn&apos;t share the opponent&apos;s full deck)
          </span>
        )}
        {deck.name && (
          <span style={{ fontSize: 11, color: '#a0a8b8', fontStyle: 'italic' }}>
            “{deck.name}”
          </span>
        )}
        {mainCount > 0 && (
          <button
            type="button"
            onClick={() => setFit((v) => !v)}
            title={fit ? 'Bigger cards (scroll to see all)' : 'Fit the whole deck on screen'}
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #2e333c', borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 600, color: '#a7d2ff', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >
            {fit ? '⊞ Larger' : '⊟ Fit all'}
          </button>
        )}
        {fullPageHref && (
          <Link
            href={fullPageHref}
            style={{ marginLeft: hasFullDeck ? undefined : 'auto', fontSize: 11, color: '#5db4ff', textDecoration: 'none', fontWeight: 600 }}
          >
            View full page →
          </Link>
        )}
      </header>

      {twoCol ? (
        <div style={{ display: 'flex', gap: COL_GAP, alignItems: 'flex-start' }}>
          <div style={{ width: LEFT_W, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {deck.leader && <CardThumb card={deck.leader} isLeader />}
              {deck.base && <CardThumb card={deck.base} />}
            </div>
            {totalSide > 0 && deck.sideboard && (
              <DeckList title="Sideboard" cards={deck.sideboard} fitWidth={sideFitW} containerW={LEFT_W} />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {mainCards && (
              <DeckList title={mainTitle} cards={mainCards} fitWidth={mainFitW} containerW={mainW} />
            )}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6 }}>
            {deck.leader && <CardThumb card={deck.leader} isLeader />}
            {deck.base && <CardThumb card={deck.base} />}
          </div>
          {mainCards && (
            <DeckList title={mainTitle} cards={mainCards} fitWidth={mainFitW} containerW={box?.w} />
          )}
          {totalSide > 0 && deck.sideboard && (
            <DeckList title="Sideboard" cards={deck.sideboard} fitWidth={mainFitW} containerW={box?.w} />
          )}
        </>
      )}
    </section>
  );
}

export function DeckList({ title, cards, fitWidth, containerW }: { title: string; cards: DeckCardRef[]; fitWidth?: number | null; containerW?: number }) {
  // B208: "Fit all" (fitWidth set) → a fixed solver-chosen card width with
  // balanced row lengths, centered, so the whole deck fits the viewport at the
  // largest size possible. "Larger" (no fitWidth) → auto-fill at a roomy size
  // that scrolls, for reading card text.
  const narrow = useMediaQuery('(max-width: 640px)');
  // Sort by cost asc, then by id for stable ordering. Matches karabast's
  // deckbuilder display order.
  const sorted = [...cards].sort((a, b) => {
    const ac = a.cost ?? 99;
    const bc = b.cost ?? 99;
    if (ac !== bc) return ac - bc;
    return a.id.localeCompare(b.id);
  });
  const fitted = !!fitWidth && !!containerW;
  const cols = fitted ? balancedCols(containerW!, fitWidth!, sorted.length) : 0;
  const compact = !!fitWidth && fitWidth < 92;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 11, color: '#a0a8b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
        {title}
      </h3>
      <div style={{
        display: 'grid',
        gridTemplateColumns: fitted
          ? `repeat(${cols}, ${fitWidth}px)`
          : `repeat(auto-fill, minmax(${narrow ? 120 : 180}px, 1fr))`,
        gap: fitted && fitWidth! < 88 ? 5 : 8,
        justifyContent: fitted ? 'center' : undefined,
      }}>
        {sorted.map((c, i) => (
          <CardThumb key={`${c.id}-${i}`} card={c} compact={compact} />
        ))}
      </div>
    </section>
  );
}

export function CardThumb({ card, isLeader = false, compact = false }: { card: DeckCardRef; isLeader?: boolean; compact?: boolean }) {
  const badge = compact ? 24 : 32;
  const setId = parseSetIdLocal(card.id);
  const url = setId ? cardImageUrl({ set: setId.set, number: setId.number }, isLeader) : null;
  return (
    <a
      href={`https://swudb.com/card/${card.id}`}
      target="_blank"
      rel="noreferrer"
      title={card.id + (card.cost != null ? ` · cost ${card.cost}` : '')}
      // Padding-bottom reserves space for the count badge that hangs
      // below the card art, matching karabast's deck-view layout.
      style={{
        position: 'relative',
        display: 'block',
        textDecoration: 'none',
        color: '#e6e6e6',
        paddingBottom: compact ? 12 : 16,
      }}
    >
      <div
        style={{
          aspectRatio: isLeader ? '1.4' : '0.71',
          background: '#0b0b12',
          border: '1px solid #2e333c',
          borderRadius: 6,
          backgroundImage: url ? `url(${url})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          minHeight: 100,
        }}
      />
      <span
        // karabast-style count badge: circular, dark, hangs over the
        // bottom-center edge of the card. Always rendered (even for
        // count === 1) — matches karabast's deck-view affordance, makes
        // copy counts scannable at a glance.
        style={{
          position: 'absolute',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: badge,
          height: badge,
          borderRadius: '50%',
          background: '#0a0c10',
          border: '2px solid #2e333c',
          color: '#fff',
          fontSize: compact ? 11 : 14,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
          boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
        }}
      >
        {card.count}
      </span>
    </a>
  );
}

function sumCounts(cards: DeckCardRef[]): number {
  return cards.reduce((acc, c) => acc + (c.count || 0), 0);
}

// SET_NNN → { set, number }. Mirrors lib/cardImage.ts but local to the
// thumb renderer; the cards in lobbyState come as `id` strings.
function parseSetIdLocal(id: string): { set: string; number: number } | null {
  const m = /^([A-Z]+)_?(\d+)$/.exec(id);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  if (!Number.isFinite(n)) return null;
  return { set: m[1], number: n };
}
