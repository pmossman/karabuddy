'use client';

// B227: Team Sideboarding Drills — the sibling of TeamOpenings. Quiz teammates
// on what they'd swap going INTO a Bo3 game (2/3), then reveal the recorder's
// actual swap + the team. v0: a queue of unanswered decisions you drill through
// (matchup context → swap builder → reveal); polish (filters, coaching mode,
// discussion) layers on like Openings did.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LeaderBasePair } from '@/app/_components/LeaderBasePair';
import { EmptyState, ErrorNote, Loading } from '@/app/_components/StatusUi';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { QuizCard, GradientBorderButton, type QuizCardRef } from './OpeningPromptKit';
import { relativeTime } from '@/lib/datetime';

interface SideCard extends QuizCardRef { count: number; aspects?: string[] | null; type?: string | null }
interface PoolItem {
  replaySlug: string; gameNumber: number; wonPrevious: boolean | null;
  ownLeader: any; ownBase: any; oppLeader: any; oppBase: any;
  createdAt: string; mine: boolean; answered: boolean; responseCount: number; commentCount: number;
}
interface ResponseView { userId: string; name: string | null; swappedIn: string[]; swappedOut: string[]; isMine: boolean }
interface Detail {
  replaySlug: string; gameNumber: number; wonPrevious: boolean | null; playedAt: string | null;
  ownLeader: any; ownBase: any; oppLeader: any; oppBase: any;
  deck: SideCard[]; sideboard: SideCard[];
  isOwner: boolean; answered: boolean;
  myResponse: { swappedIn: string[]; swappedOut: string[] } | null;
  reveal?: {
    recorder: { userId: string | null; name: string | null };
    swappedIn: string[]; swappedOut: string[]; responses: ResponseView[];
  };
}

export function TeamSideboarding({ teamSlug }: { teamSlug: string; members?: any[]; viewerName?: string }) {
  const [items, setItems] = useState<PoolItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[] | null>(null); // active gauntlet (slugs)
  const [index, setIndex] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/teams/${teamSlug}/sideboarding`);
      const j = await res.json();
      if (!j.ok) { setError(j.error || 'failed to load'); return; }
      setItems(j.data);
    } catch { setError('failed to load'); }
  }, [teamSlug]);
  useEffect(() => { void load(); }, [load]);

  const unanswered = useMemo(() => (items ?? []).filter((i) => !i.answered && !i.mine), [items]);
  const answered = useMemo(() => (items ?? []).filter((i) => i.answered && !i.mine), [items]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!items) return <Loading label="sideboard decisions" />;

  // ── GAUNTLET ──────────────────────────────────────────────────────────
  if (queue) {
    const slug = index < queue.length ? queue[index] : null;
    if (!slug) {
      return (
        <div style={{ ...panel, textAlign: 'center', maxWidth: 560, margin: '0 auto' }}>
          <div style={{ fontSize: 34 }}>🏁</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e6ebf2', marginTop: 8 }}>Session complete</div>
          <div style={{ fontSize: 13, color: '#8a93a3', marginTop: 6 }}>{queue.length} sideboard{queue.length === 1 ? '' : 's'} reviewed</div>
          <div style={{ marginTop: 18 }}>
            <GradientBorderButton onClick={() => { setQueue(null); void load(); }}>Done</GradientBorderButton>
          </div>
        </div>
      );
    }
    return (
      <SideboardStage
        key={slug}
        teamSlug={teamSlug}
        replaySlug={slug}
        position={`${index + 1} of ${queue.length}`}
        hasNext={index + 1 < queue.length}
        onNext={() => setIndex((i) => i + 1)}
        onEnd={() => { setQueue(null); void load(); }}
      />
    );
  }

  // ── SETUP ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#e6ebf2' }}>Sideboarding drills</div>
          <div style={{ fontSize: 13, color: '#8a93a3', marginTop: 4 }}>
            {unanswered.length > 0
              ? `${unanswered.length} between-games decision${unanswered.length === 1 ? '' : 's'} to drill — swap like the recorder had to.`
              : 'No new sideboard decisions right now. They appear as teammates upload Bo3 games.'}
          </div>
        </div>
        {unanswered.length > 0 && (
          <GradientBorderButton testId="sideboard-begin" onClick={() => { setQueue(unanswered.map((i) => i.replaySlug)); setIndex(0); }}>
            Start drilling
          </GradientBorderButton>
        )}
      </div>

      {unanswered.length > 0 && (
        <PoolList title={`To drill · ${unanswered.length}`} items={unanswered} onPick={(slug) => { setQueue([slug]); setIndex(0); }} />
      )}
      {answered.length > 0 && (
        <PoolList title={`Reviewed · ${answered.length}`} items={answered} muted onPick={(slug) => { setQueue([slug]); setIndex(0); }} />
      )}
      {unanswered.length === 0 && answered.length === 0 && (
        <EmptyState>No sideboard decisions yet — they surface from team-shared Bo3 games.</EmptyState>
      )}
    </div>
  );
}

const panel: React.CSSProperties = {
  background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`,
  borderRadius: tokens.radius.md, padding: 18,
};

function PoolList({ title, items, onPick, muted }: { title: string; items: PoolItem[]; onPick: (slug: string) => void; muted?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a93a3', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {items.map((it) => (
          <button
            key={it.replaySlug}
            type="button"
            data-testid="sideboard-row"
            onClick={() => onPick(it.replaySlug)}
            style={{ ...panel, padding: 10, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left', opacity: muted ? 0.75 : 1 }}
          >
            <LeaderBasePair leader={it.oppLeader} base={it.oppBase} orientation="overlap" width={40} height={28} fit="cover" radius={4} fallback="hide" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e6ebf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Game {it.gameNumber} · vs {(it.oppLeader?.name as string) ?? '?'}
              </div>
              <div style={{ fontSize: 11.5, color: '#8a93a3' }}>
                {it.wonPrevious == null ? '' : it.wonPrevious ? 'won the last game · ' : 'lost the last game · '}
                {relativeTime(it.createdAt, { fallbackToDate: true })}
                {it.responseCount > 0 ? ` · ${it.responseCount} answered` : ''}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── The drill: matchup context → swap builder → reveal ────────────────────
function SideboardStage({ teamSlug, replaySlug, position, hasNext, onNext, onEnd }: {
  teamSlug: string; replaySlug: string; position: string; hasNext: boolean; onNext: () => void; onEnd: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // per-cardId counts the viewer is cutting / bringing in
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
      const res = await fetch(`/api/replays/${replaySlug}/sideboard`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ swappedIn, swappedOut }),
      });
      const j = await res.json();
      if (!j.ok) { setError(j.error || 'submit failed'); return; }
      setDetail(j.data);
    } catch { setError('submit failed'); } finally { setSubmitting(false); }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!detail) return <Loading label="the deck" />;

  const cutTotal = Object.values(cut).reduce((a, b) => a + b, 0);
  const bringTotal = Object.values(bring).reduce((a, b) => a + b, 0);
  const showReveal = !!detail.reveal;

  const header = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={onEnd} style={backBtn}>← Back</button>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#c8cdd8' }}>Sideboard {position}</span>
      </div>
      <Matchup detail={detail} />
    </div>
  );

  if (showReveal) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>{header}<Reveal detail={detail} hasNext={hasNext} onNext={onNext} onEnd={onEnd} /></div>;
  }

  const cycle = (setter: (fn: (p: Record<string, number>) => Record<string, number>) => void, id: string, max: number) =>
    setter((p) => ({ ...p, [id]: ((p[id] ?? 0) + 1) > max ? 0 : (p[id] ?? 0) + 1 }));

  return (
    <div data-testid="sideboard-stage" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      {header}
      <div style={{ fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
        {detail.wonPrevious == null ? 'Going into the next game' : detail.wonPrevious ? 'You WON the previous game.' : 'You LOST the previous game.'}{' '}
        What do you change? Click cards to cut from your deck and bring in from your sideboard.
      </div>

      <CardZone label={`Sideboard — bring in (${bringTotal})`} cards={detail.sideboard} counts={bring} tone="in" onClick={(id, max) => cycle(setBring, id, max)} testId="sideboard-in" />
      <CardZone label={`Your deck — cut (${cutTotal})`} cards={detail.deck} counts={cut} tone="out" onClick={(id, max) => cycle(setCut, id, max)} testId="sideboard-out" />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', position: 'sticky', bottom: 0, background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.md, padding: '10px 14px' }}>
        <span style={{ fontSize: 12.5, color: '#8a93a3' }}>
          {cutTotal === 0 && bringTotal === 0 ? 'No changes — keep the same 75' : `Cutting ${cutTotal} · bringing in ${bringTotal}`}
        </span>
        <span style={{ flex: 1 }} />
        <GradientBorderButton testId="sideboard-confirm" onClick={submit} disabled={submitting} style={{ padding: '0.55rem 1.3rem' }}>
          {cutTotal === 0 && bringTotal === 0 ? 'Keep the same' : 'Lock in swap'}
        </GradientBorderButton>
      </div>
    </div>
  );
}

const backBtn: React.CSSProperties = { background: 'transparent', border: '1px solid #2e333c', borderRadius: 6, color: '#a0a8b8', fontFamily: 'inherit', fontSize: 12, padding: '5px 10px', cursor: 'pointer' };

function Matchup({ detail }: { detail: Detail }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, flexWrap: 'wrap', padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <LeaderBasePair leader={detail.ownLeader} base={detail.ownBase} orientation="overlap" width={92} height={66} fit="cover" radius={6} fallback="hide" />
        <div><div style={{ fontSize: 15, fontWeight: 800, color: '#e6ebf2' }}>You</div><div style={{ fontSize: 12.5, color: '#8a93a3' }}>{detail.ownLeader?.name ?? '?'}</div></div>
      </div>
      <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.1em', color: '#6c7588' }}>VS</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexDirection: 'row-reverse' }}>
        <LeaderBasePair leader={detail.oppLeader} base={detail.oppBase} orientation="overlap" reverse width={92} height={66} fit="cover" radius={6} fallback="hide" />
        <div style={{ textAlign: 'right' }}><div style={{ fontSize: 15, fontWeight: 800, color: '#e6ebf2' }}>Opponent</div><div style={{ fontSize: 12.5, color: '#8a93a3' }}>{detail.oppLeader?.name ?? '?'}</div></div>
      </div>
    </div>
  );
}

// A grid of the deck / sideboard; each unique card cycles a cut/in count on
// click (0→count→0), shown as a lifted + colored copy.
function CardZone({ label, cards, counts, tone, onClick, testId }: {
  label: string; cards: SideCard[]; counts: Record<string, number>; tone: 'in' | 'out'; onClick: (id: string, max: number) => void; testId: string;
}) {
  const color = tone === 'in' ? '#00E25B' : '#FF8E7A';
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3', marginBottom: 8 }}>{label}</div>
      {cards.length === 0 ? (
        <div style={{ fontSize: 12, color: '#6c7588' }}>{tone === 'in' ? 'No sideboard recorded.' : 'No deck recorded.'}</div>
      ) : (
        <div data-testid={testId} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {cards.map((c) => {
            const n = counts[c.id] ?? 0;
            return (
              <button key={c.id} type="button" onClick={() => onClick(c.id, c.count)} data-picked={n > 0 ? '1' : undefined}
                style={{ position: 'relative', background: 'transparent', border: 0, padding: 0, cursor: 'pointer', transform: n > 0 ? 'translateY(-6px)' : 'none', transition: 'transform 90ms' }}>
                <QuizCard card={c} width={58} noPreview mini muted={n === 0 ? false : false} verdict={n > 0 ? { color, label: tone === 'in' ? 'in' : 'out' } as any : undefined} />
                {c.count > 1 && <span style={{ position: 'absolute', top: 2, left: 2, fontSize: 9, fontWeight: 800, color: '#e6ebf2', background: 'rgba(0,0,0,0.75)', borderRadius: 4, padding: '0 4px' }}>×{c.count}</span>}
                {n > 0 && <span style={{ position: 'absolute', bottom: 2, right: 2, fontSize: 10, fontWeight: 800, color: '#0b0e13', background: color, borderRadius: 4, padding: '0 5px' }}>{tone === 'in' ? '+' : '−'}{n}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Reveal({ detail, hasNext, onNext, onEnd }: { detail: Detail; hasNext: boolean; onNext: () => void; onEnd: () => void }) {
  const rv = detail.reveal!;
  const mine = detail.myResponse;
  const idToCard = new Map<string, SideCard>();
  for (const c of [...detail.deck, ...detail.sideboard]) idToCard.set(c.id, c);
  const cardsFor = (ids: string[]) => ids.map((id) => idToCard.get(id)).filter(Boolean) as SideCard[];

  const recIn = new Set(rv.swappedIn), recOut = new Set(rv.swappedOut);
  const kept = rv.swappedIn.length === 0 && rv.swappedOut.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* The recorder's actual call */}
      <div style={{ ...panel }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#e6ebf2', marginBottom: 10 }}>
          {rv.recorder.name ?? 'The recorder'} {kept ? 'kept the same 75' : `swapped ${rv.swappedOut.length} out, ${rv.swappedIn.length} in`}
        </div>
        {!kept && (
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
            <SwapCol title="Out" tone="#FF8E7A" cards={cardsFor(rv.swappedOut)} mineSet={new Set(mine?.swappedOut ?? [])} />
            <SwapCol title="In" tone="#00E25B" cards={cardsFor(rv.swappedIn)} mineSet={new Set(mine?.swappedIn ?? [])} />
          </div>
        )}
      </div>

      {/* Your call vs theirs */}
      {mine && (
        <div style={{ ...panel }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#e6ebf2', marginBottom: 10 }}>Your swap</div>
          {mine.swappedIn.length === 0 && mine.swappedOut.length === 0 ? (
            <div style={{ fontSize: 12.5, color: '#8a93a3' }}>You kept the same 75.{kept ? ' Same as the recorder.' : ''}</div>
          ) : (
            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
              <SwapCol title="You cut" tone="#FF8E7A" cards={cardsFor(mine.swappedOut)} mineSet={recOut} matchLabel />
              <SwapCol title="You brought in" tone="#00E25B" cards={cardsFor(mine.swappedIn)} mineSet={recIn} matchLabel />
            </div>
          )}
          <div style={{ fontSize: 11.5, color: '#8a93a3', marginTop: 8 }}>Green outline = the recorder made the same move.</div>
        </div>
      )}

      {/* Team responses */}
      {rv.responses.filter((r) => !r.isMine).length > 0 && (
        <div style={{ ...panel }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3', marginBottom: 10 }}>Rest of the team</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rv.responses.filter((r) => !r.isMine).map((r) => (
              <div key={r.userId} style={{ fontSize: 12.5, color: '#c8cdd8' }}>
                <span style={{ fontWeight: 700 }}>{r.name ?? 'Teammate'}</span>{' — '}
                {r.swappedIn.length === 0 && r.swappedOut.length === 0 ? 'kept the same' : `${r.swappedOut.length} out / ${r.swappedIn.length} in`}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <GradientBorderButton testId="sideboard-next" onClick={hasNext ? onNext : onEnd} style={{ padding: '0.55rem 1.3rem' }}>
          {hasNext ? 'Next decision' : 'Finish'}
        </GradientBorderButton>
      </div>
    </div>
  );
}

function SwapCol({ title, tone, cards, mineSet, matchLabel }: { title: string; tone: string; cards: SideCard[]; mineSet: Set<string>; matchLabel?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: tone, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {cards.length === 0 ? <span style={{ fontSize: 12, color: '#6c7588' }}>—</span> : cards.map((c, i) => {
          const match = mineSet.has(c.id);
          return (
            <div key={`${c.id}-${i}`} data-testid={matchLabel && match ? 'sideboard-match' : undefined} style={{ borderRadius: 8, outline: match ? '2px solid #00E25B' : 'none', outlineOffset: 1 }}>
              <QuizCard card={c} width={56} noPreview mini />
            </div>
          );
        })}
      </div>
    </div>
  );
}
