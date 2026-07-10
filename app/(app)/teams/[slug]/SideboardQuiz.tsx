'use client';

// B227: the Sideboarding drill STAGE — the sibling of OpeningQuiz's OpeningStage,
// sharing its VISUAL LANGUAGE: cyan selection while you build the swap, then a
// reveal where every card is colored by agreement (green = you AND the recorder
// made this exact move, yellow = only you, salmon = only them), with the
// recorder's swap and yours stacked as tinted anchor blocks and the rest of the
// team grouped below. Matches Openings so the two drills feel like one tool.

import { useEffect, useState } from 'react';
import { LeaderBasePair } from '@/app/_components/LeaderBasePair';
import { ErrorNote, Loading } from '@/app/_components/StatusUi';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { multisetEquals } from '@/lib/multiset';
import { QuizCard, GradientBorderButton, type QuizCardRef, type PickVerdict } from './OpeningPromptKit';
import { DeckList } from '@/app/(app)/r/[slug]/Decks';
import type { DrillStageProps } from './TeamDrills';

interface SideCard extends QuizCardRef { count: number }
interface ResponseView { userId: string; name: string | null; swappedIn: string[]; swappedOut: string[]; isMine: boolean }
interface Detail {
  replaySlug: string; gameNumber: number; wonPrevious: boolean | null;
  ownLeader: any; ownBase: any; oppLeader: any; oppBase: any;
  deck: SideCard[]; sideboard: SideCard[];
  isOwner: boolean; answered: boolean;
  myResponse: { swappedIn: string[]; swappedOut: string[] } | null;
  reveal?: { recorder: { userId: string | null; name: string | null }; swappedIn: string[]; swappedOut: string[]; responses: ResponseView[] };
}

const panel: React.CSSProperties = { background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.md, padding: 18 };
const CYAN = '#66E5FF';

export function SideboardStage({ replaySlug, hasNext, onAnswered, onNext, finishLabel }: DrillStageProps) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cut, setCut] = useState<Record<string, number>>({});
  const [bring, setBring] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let dead = false;
    setDetail(null); setError(null); setCut({}); setBring({});
    (async () => {
      try {
        const res = await fetch(`/api/replays/${replaySlug}/sideboard`);
        const j = await res.json();
        if (dead) return;
        if (!j.ok) { setError(j.error || 'failed'); return; }
        setDetail(j.data);
      } catch { if (!dead) setError('failed'); }
    })();
    return () => { dead = true; };
  }, [replaySlug]);

  const submit = async () => {
    if (!detail || submitting) return;
    setSubmitting(true);
    const swappedOut = Object.entries(cut).flatMap(([id, n]) => Array(n).fill(id));
    const swappedIn = Object.entries(bring).flatMap(([id, n]) => Array(n).fill(id));
    try {
      const res = await fetch(`/api/replays/${replaySlug}/sideboard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ swappedIn, swappedOut }) });
      const j = await res.json();
      if (!j.ok) { setError(j.error || 'submit failed'); return; }
      setDetail(j.data);
      if (j.data.reveal) {
        const same = multisetEquals(swappedIn, j.data.reveal.swappedIn) && multisetEquals(swappedOut, j.data.reveal.swappedOut);
        onAnswered(replaySlug, same);
      }
    } catch { setError('submit failed'); } finally { setSubmitting(false); }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!detail) return <Loading label="the deck" />;

  const cutTotal = Object.values(cut).reduce((a, b) => a + b, 0);
  const bringTotal = Object.values(bring).reduce((a, b) => a + b, 0);
  const matchup = <Matchup detail={detail} />;

  if (detail.reveal) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>{matchup}<Reveal detail={detail} hasNext={hasNext} onNext={onNext} finishLabel={finishLabel} /></div>;
  }

  const cycle = (setter: (fn: (p: Record<string, number>) => Record<string, number>) => void, id: string, max: number) =>
    setter((p) => ({ ...p, [id]: ((p[id] ?? 0) + 1) > max ? 0 : (p[id] ?? 0) + 1 }));

  return (
    <div data-testid="sideboard-stage" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      {matchup}
      <div style={{ fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
        {detail.wonPrevious == null ? 'Going into the next game.' : detail.wonPrevious ? 'You WON the previous game.' : 'You LOST the previous game.'}{' '}
        What do you change? Click cards to cut from your deck and bring in from your sideboard.
      </div>
      <PickZone label={`Bring in from sideboard · ${bringTotal}`} cards={detail.sideboard} counts={bring} onClick={(id, max) => cycle(setBring, id, max)} testId="sideboard-in" />
      <PickZone label={`Cut from your deck · ${cutTotal}`} cards={detail.deck} counts={cut} onClick={(id, max) => cycle(setCut, id, max)} testId="sideboard-out" />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', position: 'sticky', bottom: 0, ...panel, padding: '10px 14px' }}>
        <span style={{ fontSize: 12.5, color: '#8a93a3' }}>{cutTotal === 0 && bringTotal === 0 ? 'No changes — keep the same 75' : `Cutting ${cutTotal} · bringing in ${bringTotal}`}</span>
        <span style={{ flex: 1 }} />
        <GradientBorderButton testId="sideboard-confirm" onClick={submit} disabled={submitting} style={{ padding: '0.55rem 1.3rem' }}>
          {cutTotal === 0 && bringTotal === 0 ? 'Keep the same' : 'Lock in swap'}
        </GradientBorderButton>
      </div>
    </div>
  );
}

function Matchup({ detail }: { detail: Detail }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, flexWrap: 'wrap', padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <LeaderBasePair leader={detail.ownLeader} base={detail.ownBase} orientation="overlap" width={92} height={66} fit="cover" radius={6} fallback="hide" />
        <div><div style={{ fontSize: 15, fontWeight: 800, color: '#e6ebf2' }}>You</div><div style={{ fontSize: 12.5, color: '#8a93a3' }}>{detail.ownLeader?.name ?? '?'}</div></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.1em', color: '#6c7588' }}>VS</span>
        <span style={{ fontSize: 11, color: '#6c7588' }}>Game {detail.gameNumber}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexDirection: 'row-reverse' }}>
        <LeaderBasePair leader={detail.oppLeader} base={detail.oppBase} orientation="overlap" reverse width={92} height={66} fit="cover" radius={6} fallback="hide" />
        <div style={{ textAlign: 'right' }}><div style={{ fontSize: 15, fontWeight: 800, color: '#e6ebf2' }}>Opponent</div><div style={{ fontSize: 12.5, color: '#8a93a3' }}>{detail.oppLeader?.name ?? '?'}</div></div>
      </div>
    </div>
  );
}

// The swap builder: click cards to add copies to the swap. Selection is CYAN
// (Openings' picking glow) — the section already says in vs out, so color is
// free to mean "selected", matching Openings.
function PickZone({ label, cards, counts, onClick, testId }: { label: string; cards: SideCard[]; counts: Record<string, number>; onClick: (id: string, max: number) => void; testId: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3', marginBottom: 8 }}>{label}</div>
      {cards.length === 0 ? (
        <div style={{ fontSize: 12, color: '#6c7588' }}>Nothing recorded.</div>
      ) : (
        <div data-testid={testId} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {cards.map((c) => {
            const n = counts[c.id] ?? 0;
            return (
              <button key={c.id} type="button" onClick={() => onClick(c.id, c.count)} data-picked={n > 0 ? '1' : undefined}
                style={{ position: 'relative', background: 'transparent', border: 0, padding: 0, cursor: 'pointer', transform: n > 0 ? 'translateY(-6px)' : 'none', transition: 'transform 90ms' }}>
                <QuizCard card={c} width={58} noPreview mini selected={n > 0} />
                {c.count > 1 && <span style={{ position: 'absolute', top: 2, left: 2, fontSize: 9, fontWeight: 800, color: '#e6ebf2', background: 'rgba(0,0,0,0.75)', borderRadius: 4, padding: '0 4px' }}>×{c.count}</span>}
                {n > 0 && <span style={{ position: 'absolute', bottom: 2, right: 2, fontSize: 10, fontWeight: 800, color: '#0b0e13', background: CYAN, borderRadius: 4, padding: '0 5px' }}>×{n}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Reveal — the Openings visual language applied to swaps ────────────────

type Tone = 'recorder' | 'viewer' | 'other';
interface SwapRecord {
  key: string; name: string; names?: string[]; tone: Tone; kept: boolean;
  out: { card: SideCard; verdict?: PickVerdict }[];
  in: { card: SideCard; verdict?: PickVerdict }[];
}

// Match `cards` against a reference multiset: a card in the reference → 'match'
// (green), otherwise `elseV` (yellow for the viewer, salmon for others).
function judge(cards: SideCard[], refIds: string[] | null, elseV: PickVerdict): { card: SideCard; verdict?: PickVerdict }[] {
  if (!refIds) return cards.map((card) => ({ card }));
  const pool = [...refIds];
  return cards.map((card) => {
    const at = pool.indexOf(card.id);
    if (at >= 0) { pool.splice(at, 1); return { card, verdict: 'match' as PickVerdict }; }
    return { card, verdict: elseV };
  });
}

function Reveal({ detail, hasNext, onNext, finishLabel }: { detail: Detail; hasNext: boolean; onNext: () => void; finishLabel: string }) {
  const rv = detail.reveal!;
  const mine = detail.myResponse;
  const idToCard = new Map<string, SideCard>();
  for (const c of [...detail.deck, ...detail.sideboard]) idToCard.set(c.id, c);
  const cardsFor = (ids: string[]) => ids.map((id) => idToCard.get(id)).filter(Boolean) as SideCard[];

  // The viewer's swap is the comparison reference (like Openings): the recorder
  // is measured against YOU (theirs = they moved it, you didn't), you against
  // the recorder (mine = only you), and teammates against you.
  const myOut = mine?.swappedOut ?? null;
  const myIn = mine?.swappedIn ?? null;

  const recorderRec: SwapRecord = {
    key: '__rec__', name: rv.recorder.name ?? 'Recorder', tone: 'recorder',
    kept: rv.swappedOut.length === 0 && rv.swappedIn.length === 0,
    out: judge(cardsFor(rv.swappedOut), myOut, 'theirs'),
    in: judge(cardsFor(rv.swappedIn), myIn, 'theirs'),
  };
  const viewerRec: SwapRecord | null = mine ? {
    key: '__you__', name: 'You', tone: 'viewer',
    kept: mine.swappedOut.length === 0 && mine.swappedIn.length === 0,
    out: judge(cardsFor(mine.swappedOut), rv.swappedOut, 'mine'),
    in: judge(cardsFor(mine.swappedIn), rv.swappedIn, 'mine'),
  } : null;

  // Group teammates with the identical swap into one cell (Openings pattern).
  const groups = new Map<string, { rep: ResponseView; names: string[] }>();
  for (const r of rv.responses) {
    if (r.isMine) continue;
    const key = `${[...r.swappedOut].sort().join(',')}|${[...r.swappedIn].sort().join(',')}`;
    const g = groups.get(key);
    if (g) g.names.push(r.name ?? 'Teammate');
    else groups.set(key, { rep: r, names: [r.name ?? 'Teammate'] });
  }
  const refOut = myOut ?? rv.swappedOut;
  const refIn = myIn ?? rv.swappedIn;
  const others: SwapRecord[] = [...groups.values()].map(({ rep, names }) => ({
    key: rep.userId, name: names[0], names, tone: 'other',
    kept: rep.swappedOut.length === 0 && rep.swappedIn.length === 0,
    out: judge(cardsFor(rep.swappedOut), refOut, 'theirs'),
    in: judge(cardsFor(rep.swappedIn), refIn, 'theirs'),
  }));

  const sameAsRecorder = mine ? multisetEquals(mine.swappedOut, rv.swappedOut) && multisetEquals(mine.swappedIn, rv.swappedIn) : null;

  return (
    <div data-testid="sideboard-reveal" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* The two calls + agreement, stated like Openings — no right/wrong. */}
      {viewerRec && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, border: `1px solid ${CYAN}`, color: CYAN }}>{swapText(viewerRec, 'You')}</span>
          <span style={{ color: '#6c7588', fontWeight: 700, fontSize: 12 }}>·</span>
          <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, border: '1px solid #2e333c', color: '#c8cdd8' }}>{swapText(recorderRec, recorderRec.name)}</span>
        </div>
      )}
      {sameAsRecorder !== null && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <span data-testid="sideboard-agreement" style={{ padding: '3px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, border: `1px solid ${sameAsRecorder ? '#00E25B' : '#FFD60A'}`, color: sameAsRecorder ? '#6bd968' : '#FFD60A' }}>
            {sameAsRecorder ? '✓ Same swap as the recorder' : '≈ Different swap'}
          </span>
        </div>
      )}

      {/* Anchors: the recorder's actual call, then yours, stacked full width. */}
      <SwapBlock rec={recorderRec} wide />
      {viewerRec && <SwapBlock rec={viewerRec} wide />}

      {others.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a93a3', marginBottom: 8 }}>Rest of the team · {others.length}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {others.map((rec) => <SwapBlock key={rec.key} rec={rec} />)}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: '#8a93a3', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Legend color="#00E25B" text="you both made this move" />
        <Legend color="#FFD60A" text="only you" />
        <Legend color="#FF8E7A" text="only them" />
      </div>

      {/* The full game-N list, for context — collapsed so the swap stays the focus. */}
      <FullDeck detail={detail} />

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <GradientBorderButton testId="sideboard-next" onClick={onNext} style={{ padding: '0.55rem 1.3rem' }}>{hasNext ? 'Next decision' : finishLabel}</GradientBorderButton>
      </div>
    </div>
  );
}

// The full game-N maindeck + sideboard, collapsed by default. Reuses the
// viewer's DeckList (cost-sorted card thumbs + count badges) — a SideCard is
// structurally a DeckCardRef.
function FullDeck({ detail }: { detail: Detail }) {
  const [open, setOpen] = useState(false);
  const deckCount = detail.deck.reduce((s, c) => s + (c.count || 1), 0);
  const sbCount = detail.sideboard.reduce((s, c) => s + (c.count || 1), 0);
  return (
    <div style={{ ...panel, padding: open ? 14 : '11px 14px' }}>
      <button type="button" data-testid="sideboard-full-deck-toggle" onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'transparent', border: 0, color: '#c8cdd8', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0, textAlign: 'left' }}>
        <span style={{ color: '#6c7588', width: 12 }}>{open ? '▾' : '▸'}</span>
        Full game {detail.gameNumber} deck
        <span style={{ color: '#6c7588', fontWeight: 400 }}>· {deckCount} cards · {sbCount} sideboard</span>
      </button>
      {open && (
        <div data-testid="sideboard-full-deck" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Small thumbs so most/all of the deck is visible at once; auto-fill
              packs more columns as the screen widens. */}
          <DeckList title={`Deck · ${deckCount}`} cards={detail.deck} minCardWidth={72} />
          {detail.sideboard.length > 0 && <DeckList title={`Sideboard · ${sbCount}`} cards={detail.sideboard} minCardWidth={72} />}
        </div>
      )}
    </div>
  );
}

function swapText(rec: SwapRecord, who: string): string {
  if (rec.kept) return `${who} kept the same`;
  return `${who} swapped ${rec.out.length} out, ${rec.in.length} in`;
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 11, height: 15, borderRadius: 3, border: `2px solid ${color}`, boxShadow: `0 0 5px 1px ${color}66`, display: 'inline-block' }} /> {text}
    </span>
  );
}

// One participant's swap, tinted by tone (recorder green / you cyan / other
// neutral) — the MemberBlock analogue.
function SwapBlock({ rec, wide }: { rec: SwapRecord; wide?: boolean }) {
  const tint = rec.tone === 'recorder'
    ? { background: 'rgba(0,226,91,0.06)', border: '1px solid rgba(0,226,91,0.35)' }
    : rec.tone === 'viewer'
      ? { background: 'rgba(102,229,255,0.06)', border: '1px solid rgba(102,229,255,0.35)' }
      : { background: 'rgba(255,255,255,0.03)', border: '1px solid #2e333c' };
  const suffixColor = rec.tone === 'recorder' ? '#6bd968' : rec.tone === 'viewer' ? CYAN : '#6c7588';
  const grouped = (rec.names?.length ?? 1) > 1;
  const w = wide ? 62 : 50;
  return (
    <div data-testid={rec.tone === 'recorder' ? 'sideboard-block-recorder' : rec.tone === 'viewer' ? 'sideboard-block-you' : undefined}
      style={{ ...tint, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8, padding: wide ? '12px 14px' : '10px', borderRadius: 8, width: '100%', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {grouped && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: '#e6ebf2', background: 'rgba(255,255,255,0.08)', borderRadius: 999, padding: '1px 8px' }}>×{rec.names!.length}</span>}
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: '#e6ebf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={grouped ? rec.names!.join(', ') : undefined}>
          {grouped ? rec.names!.join(', ') : rec.name}{' '}
          <span style={{ color: suffixColor, fontWeight: rec.tone === 'other' ? 400 : 700 }}>· {rec.kept ? 'kept the same' : `${rec.out.length} out, ${rec.in.length} in`}</span>
        </span>
      </div>
      {rec.kept ? (
        <div style={{ fontSize: 12, color: '#6c7588', fontStyle: 'italic' }}>No changes — same 75.</div>
      ) : (
        <div style={{ display: 'flex', gap: wide ? 20 : 12, flexWrap: 'wrap' }}>
          <SwapDir label="Out" arrow="↓" cards={rec.out} width={w} />
          <SwapDir label="In" arrow="↑" cards={rec.in} width={w} />
        </div>
      )}
    </div>
  );
}

function SwapDir({ label, arrow, cards, width }: { label: string; arrow: string; cards: { card: SideCard; verdict?: PickVerdict }[]; width: number }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6c7588', marginBottom: 5 }}>{arrow} {label}</div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {cards.length === 0 ? <span style={{ fontSize: 12, color: '#4a5160' }}>—</span> : cards.map(({ card, verdict }, i) => (
          <QuizCard key={`${card.id}-${i}`} card={card} width={width} verdict={verdict} noPreview mini />
        ))}
      </div>
    </div>
  );
}
