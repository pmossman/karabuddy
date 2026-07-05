'use client';

// B221: the gauntlet STAGE — one opening rendered like sitting at the karabast
// table during setup: the opponent's leader/base across the top, your (well,
// the recorder's) hand laid flat at the bottom (karabast doesn't curve the
// hand), and the setup prompt in the middle using karabast's own copy
// ("Choose whether to mulligan or keep your hand" / "Select 2 cards to
// resource" / "Confirm Resources"). The hand row IS the stage-2 picker.
// After submit the same stage becomes the reveal (recorded
// decision + identity + distribution + watch link + the tag composer), with a
// Next button that advances the gauntlet.
//
// Keyboard: K = keep, M = mulligan, Enter = confirm picks / next opening.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorNote, Loading } from '@/app/_components/StatusUi';
import { glowButtonStyle } from '@/app/_components/glowButton';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { getOrCreateInstallToken } from '@/lib/installToken';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { OpeningWatchModal, prepareWatch } from './OpeningWatchModal';
import {
  GradientBorderButton,
  HandRow,
  InitiativePill,
  QuizCard,
  SeatCard,
  promptPanelStyle,
  promptTextStyle,
  promptTitleStyle,
  type QuizCardRef,
} from './OpeningPromptKit';

interface ResponseView {
  userId: string;
  name: string | null;
  decision: 'keep' | 'mulligan';
  resourced: string[];
}
interface Reveal {
  decision: 'keep' | 'mulligan';
  resourced: QuizCardRef[];
  recorder: { userId: string | null; name: string | null };
  mulliganFrameIndex: number;
  resourceFrameIndex: number;
  responses: ResponseView[];
}
interface Detail {
  replaySlug: string;
  ownLeader: any;
  ownBase: any;
  oppLeader: any;
  oppBase: any;
  wentFirst: boolean | null;
  dealtHand: QuizCardRef[];
  keptHand: QuizCardRef[];
  isOwner: boolean;
  answered: boolean;
  myResponse: { decision: 'keep' | 'mulligan'; resourced: string[] } | null;
  reveal?: Reveal;
}

export function OpeningStage({
  teamSlug,
  replaySlug,
  viewerName,
  hasNext,
  onAnswered,
  onNext,
}: {
  teamSlug: string;
  replaySlug: string;
  viewerName: string;
  // Whether the session has another opening after this one (Next vs Finish).
  hasNext: boolean;
  // Fired once when a response lands: (slug, agreedWithRecordedDecision).
  onAnswered: (slug: string, agreed: boolean) => void;
  onNext: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'mulligan' | 'resource' | 'reveal'>('mulligan');
  const [myMulligan, setMyMulligan] = useState<'keep' | 'mulligan' | null>(null);
  const [picks, setPicks] = useState<number[]>([]); // indexes into keptHand (multiset-safe)
  const [submitting, setSubmitting] = useState(false);
  // Practice run (the redo): replay the motions against an already-answered
  // opening. Deliberately does NOT touch the stored response — first answer
  // counts, or the consensus signal could be retro-fitted after seeing the
  // reveal. `practice` holds the throwaway answer for the diff.
  const [practicing, setPracticing] = useState(false);
  const [practice, setPractice] = useState<{ decision: 'keep' | 'mulligan'; resourced: string[] } | null>(null);
  // The "Watch from the opening" mini-player. While open, the stage's own
  // keyboard flow is suspended (the player owns the arrow keys).
  const [watching, setWatching] = useState(false);

  useEffect(() => {
    let dead = false;
    setDetail(null);
    setError(null);
    setStage('mulligan');
    setMyMulligan(null);
    setPicks([]);
    setPracticing(false);
    setPractice(null);
    setWatching(false);
    (async () => {
      try {
        const res = await fetch(`/api/replays/${replaySlug}/opening`);
        const j = await res.json();
        if (dead) return;
        if (!j.ok) { setError(j.error || 'failed to load'); return; }
        setDetail(j.data);
        if (j.data.answered || j.data.isOwner) setStage('reveal');
      } catch {
        if (!dead) setError('failed to load');
      }
    })();
    return () => { dead = true; };
  }, [replaySlug]);

  const submit = useCallback(async () => {
    if (!detail || myMulligan === null || picks.length !== 2 || submitting) return;
    const sourceHand = myMulligan === 'keep' ? detail.dealtHand : detail.keptHand;
    if (practicing) {
      setPractice({ decision: myMulligan, resourced: picks.map((i) => sourceHand[i].id) });
      setStage('reveal');
      return;
    }
    setSubmitting(true);
    try {
      const resourced = picks.map((i) => sourceHand[i].id);
      const res = await fetch(`/api/replays/${replaySlug}/opening`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: myMulligan, resourced }),
      });
      const j = await res.json();
      if (!j.ok) { setError(j.error || 'submit failed'); return; }
      setDetail(j.data);
      setStage('reveal');
      if (j.data.reveal) onAnswered(replaySlug, j.data.reveal.decision === myMulligan);
    } catch {
      setError('submit failed');
    } finally {
      setSubmitting(false);
    }
  }, [detail, myMulligan, picks, replaySlug, submitting, practicing, onAnswered]);

  const togglePick = (i: number) =>
    setPicks((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < 2 ? [...p, i] : p));

  // Gauntlet keyboard flow — skipped while typing in the composer.
  useEffect(() => {
    if (watching) return; // the mini-player owns the keyboard
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
      if (stage === 'mulligan' && detail) {
        if (e.key === 'k' || e.key === 'K') { setMyMulligan('keep'); setStage('resource'); }
        if (e.key === 'm' || e.key === 'M') { setMyMulligan('mulligan'); setStage('resource'); }
      } else if (stage === 'resource' && e.key === 'Enter') {
        void submit();
      } else if (stage === 'reveal' && e.key === 'Enter') {
        onNext();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stage, detail, submit, onNext, watching]);

  // Warm the mini-player's payload cache as soon as the reveal is visible so
  // "Watch the opening" opens instantly.
  useEffect(() => {
    if (stage === 'reveal' && detail?.reveal) prepareWatch(detail.replaySlug).catch(() => {});
  }, [stage, detail]);

  // Same breakpoint as the shell + the tab container: below it the stage
  // re-composes hand-first.
  const compact = useMediaQuery('(max-width: 860px)');

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!detail) return <Loading label="Dealing the hand…" />;

  // Stage 2 follows the USER'S decision, not the recorder's — a keep answers
  // from the dealt hand (even if the recorder mulliganed: those picks are
  // the discussion data), a mulligan answers from the recorder's redraw
  // (the only one that exists; == dealt when the recorder kept). Nothing is
  // revealed until the picks land. The reveal shows the recorder's world.
  const hand =
    stage === 'mulligan' ? detail.dealtHand
    : stage === 'resource' ? (myMulligan === 'keep' ? detail.dealtHand : detail.keptHand)
    : detail.keptHand;
  // Reveal: the DIFF is painted straight onto the hand (multiset-safe index
  // assignment — duplicate copies are interchangeable): green = you both
  // resourced it, red = only they did, gray = only you did. The owner has no
  // answer of their own, so their recorded picks get the plain cyan highlight.
  const verdictByIdx = new Map<number, 'match' | 'theirs' | 'mine'>();
  const keptWorldPickIdx = new Set<number>(); // MY picks on the kept-world (fork) hand
  const theirPickIdx = new Set<number>();
  if (stage === 'reveal' && detail.reveal) {
    const theirs = detail.reveal.resourced.map((c) => c.id);
    const effective = practice ?? detail.myResponse;
    // Incomparable fork: I kept (picked from the dealt hand), they mulliganed
    // (picked from the redraw) — two different hands, no pick-vs-pick diff.
    const incomparable = !!effective && effective.decision === 'keep' && detail.reveal.decision === 'mulligan';
    if (effective && incomparable) {
      // Their picks light the live (redraw) hand; mine light the kept world.
      const remaining = [...theirs];
      detail.keptHand.forEach((c, i) => {
        const at = remaining.indexOf(c.id);
        if (at >= 0) { remaining.splice(at, 1); verdictByIdx.set(i, 'theirs'); }
      });
      const minePool = [...effective.resourced];
      detail.dealtHand.forEach((c, i) => {
        const at = minePool.indexOf(c.id);
        if (at >= 0) { minePool.splice(at, 1); keptWorldPickIdx.add(i); }
      });
    } else if (effective) {
      const matchPool: string[] = [];
      const theirsOnly = [...theirs];
      const mineOnly: string[] = [];
      for (const id of effective.resourced) {
        const at = theirsOnly.indexOf(id);
        if (at >= 0) { theirsOnly.splice(at, 1); matchPool.push(id); }
        else mineOnly.push(id);
      }
      const pools: [string[], 'match' | 'theirs' | 'mine'][] = [
        [matchPool, 'match'],
        [theirsOnly, 'theirs'],
        [mineOnly, 'mine'],
      ];
      detail.keptHand.forEach((c, i) => {
        for (const [pool, v] of pools) {
          const at = pool.indexOf(c.id);
          if (at >= 0) { pool.splice(at, 1); verdictByIdx.set(i, v); return; }
        }
      });
    } else {
      const remaining = [...theirs];
      detail.keptHand.forEach((c, i) => {
        const at = remaining.indexOf(c.id);
        if (at >= 0) { remaining.splice(at, 1); theirPickIdx.add(i); }
      });
    }
  }

  const seatLabel = detail.isOwner ? 'You' : stage === 'reveal' ? detail.reveal?.recorder.name ?? 'Your teammate' : 'Your seat';
  // Did the recorder keep? (dealt ≡ kept multiset — a keep can't change cards.)
  const kept = sameHand(detail);
  // The fork visualization: they mulliganed but YOUR call was keep — show
  // both timelines at once. Everything sizes down a notch so the redraw and
  // the kept world share the screen without scrolling.
  const effectiveDecision =
    stage === 'reveal' ? (practice ?? detail.myResponse)?.decision : myMulligan;
  // The fork view is REVEAL-only: stage 2 shows a single hand (the user's
  // world) and reveals nothing about the recorder's call.
  const dualHand = stage === 'reveal' && !kept && effectiveDecision === 'keep';

  const startPractice = () => {
    setPracticing(true);
    setPractice(null);
    setMyMulligan(null);
    setPicks([]);
    setStage('mulligan');
  };

  // The hand — the full-width bottom row, exactly like sitting at the table.
  // The reveal stacks more below the board (caption + verdict-labeled hand),
  // so the fan sizes down a notch there even in single-hand mode — the whole
  // story should sit on one screen.
  const fanShrunk = dualHand || stage === 'reveal';
  const fanW = compact ? (fanShrunk ? 112 : 132) : (fanShrunk ? 126 : 150);
  const fan = (
    <HandRow cardWidth={fanW} overlap={compact ? 56 : fanShrunk ? 30 : 24}>
      {hand.map((c, i) => (
        <QuizCard
          key={`${c.id}-${i}`}
          testId={stage === 'resource' ? `opening-pick-${i}` : undefined}
          card={c}
          width={fanW}
          selectable={stage === 'resource' ? true : undefined}
          selected={stage === 'resource' ? picks.includes(i) : stage === 'reveal' ? theirPickIdx.has(i) : undefined}
          verdict={stage === 'reveal' ? verdictByIdx.get(i) : undefined}
          onClick={stage === 'resource' ? () => togglePick(i) : undefined}
        />
      ))}
    </HandRow>
  );

  // No legend — every verdict card carries its own label. The owner view
  // (unlabeled cyan highlights) keeps a one-line caption.
  const fanCaption =
    stage === 'reveal' && verdictByIdx.size === 0 && theirPickIdx.size > 0 ? (
      <div style={{ textAlign: 'center', fontSize: 12, color: '#66E5FF', marginTop: -6 }}>
        Their resource picks
      </div>
    ) : null;

  // ONE layout for every screen size — the karabast table, scaled: the
  // center column (their leader/base above yours) dead-center, the hand
  // across the bottom, and ALL interaction floating OVER the board like the
  // game's own prompt popups. The Initiative pill hangs off the holder's
  // leader card.
  const seatW = compact ? (dualHand ? 100 : 124) : (dualHand ? 120 : 168);
  const pillAt = (holder: 'own' | 'opp') => (
    <span
      style={{
        position: 'absolute',
        left: '100%',
        marginLeft: 8,
        top: '50%',
        transform: 'translateY(-50%)',
      }}
    >
      <InitiativePill mine={holder === 'own'} small={compact} />
    </span>
  );

  const board = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: dualHand ? 5 : compact ? 8 : 10 }}>
      <div style={{ position: 'relative' }}>
        <SeatCard testId="opening-seat-opp" kind="leader" card={detail.oppLeader} label="Opponent" width={seatW} />
        {detail.wentFirst === false && pillAt('opp')}
      </div>
      <SeatCard kind="base" card={detail.oppBase} width={seatW} />
      <div style={{ height: dualHand ? 6 : compact ? 10 : 18 }} />
      <SeatCard kind="base" card={detail.ownBase} width={seatW} />
      <div style={{ position: 'relative' }}>
        <SeatCard testId="opening-seat-own" kind="leader" card={detail.ownLeader} label={seatLabel} width={seatW} />
        {detail.wentFirst === true && pillAt('own')}
      </div>
    </div>
  );

  // The floating prompt layer. pointerEvents:none on the wrapper keeps the
  // uncovered board cards hoverable; the panel itself re-enables them.
  const overlay = (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 5,
        pointerEvents: 'none',
        padding: compact ? 6 : 16,
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          width: stage === 'reveal' ? 'min(680px, 100%)' : 'min(520px, 100%)',
          maxHeight: '100%',
          overflowY: 'auto',
          filter: 'drop-shadow(0 18px 50px rgba(0,0,0,0.8))',
        }}
      >
        {stage === 'mulligan' && (
          <section style={{ ...promptPanelStyle, padding: '0.9rem 1rem 1rem' }} aria-label="Mulligan Step">
            <div style={{ ...promptTitleStyle, fontSize: '1rem' }}>Choose whether to mulligan or keep your hand</div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.8rem', justifyContent: 'center' }}>
              <GradientBorderButton testId="opening-mulligan" style={{ padding: '0.6rem 1.3rem' }} onClick={() => { setMyMulligan('mulligan'); setStage('resource'); }}>
                Mulligan <Kbd>M</Kbd>
              </GradientBorderButton>
              <GradientBorderButton testId="opening-keep" style={{ padding: '0.6rem 1.3rem' }} onClick={() => { setMyMulligan('keep'); setStage('resource'); }}>
                Keep <Kbd>K</Kbd>
              </GradientBorderButton>
            </div>
          </section>
        )}
        {stage === 'resource' && (
          <section style={{ ...promptPanelStyle, padding: '0.9rem 1rem 1rem' }} aria-label="Resource Step">
            {/* The ONE early reveal, by design: you mulliganed but they kept,
                so there IS no redraw — without saying so, the unchanged hand
                reads as a bug. The other direction (you kept, they mulliganed)
                stays unspoiled: you pick from the hand you wanted first. */}
            {myMulligan === 'mulligan' && kept && (
              <div data-testid="opening-beat" style={{ textAlign: 'center', fontSize: 13.5, fontWeight: 700, marginBottom: 6, color: '#ff7b72' }}>
                ✗ They kept this hand — pick your two from it anyway.
              </div>
            )}
            <div style={{ ...promptTitleStyle, fontSize: '1rem' }}>Select 2 cards to resource</div>
            {myMulligan === 'mulligan' && !kept && (
              <p style={{ ...promptTextStyle, margin: '4px 0 0', fontSize: 12.5 }}>You mulliganed — pick from the new hand below.</p>
            )}
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.8rem', justifyContent: 'center' }}>
              <GradientBorderButton testId="opening-confirm" style={{ padding: '0.6rem 1.3rem' }} onClick={submit} disabled={picks.length !== 2 || submitting}>
                {submitting ? 'Submitting…' : 'Confirm Resources'} <Kbd>⏎</Kbd>
              </GradientBorderButton>
            </div>
          </section>
        )}
        {stage === 'reveal' && detail.reveal && (
          <RevealPanel
            teamSlug={teamSlug}
            detail={detail}
            reveal={detail.reveal}
            viewerName={viewerName}
            hasNext={hasNext}
            onNext={onNext}
            response={practice ?? detail.myResponse}
            isPractice={!!practice}
            onRetry={detail.isOwner ? undefined : startPractice}
            onWatch={() => setWatching(true)}
          />
        )}
      </div>
    </div>
  );

  return (
    <div
      data-testid="opening-stage"
      style={{ display: 'flex', flexDirection: 'column', gap: dualHand ? 6 : compact ? 10 : 14, minWidth: 0, flex: 1 }}
    >
      <div style={{ position: 'relative' }}>
        {board}
        {overlay}
      </div>
      {/* Reveal-only: naming the hand "their redraw" before the picks would
          spoil the recorder's call. */}
      {stage === 'reveal' && !kept && (
        <div style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3', marginBottom: -4 }}>
          Their redraw
        </div>
      )}
      {watching && detail.reveal && (
        <OpeningWatchModal
          replaySlug={detail.replaySlug}
          startFrame={detail.reveal.mulliganFrameIndex}
          onClose={() => setWatching(false)}
        />
      )}
      {fan}
      {fanCaption}
      {dualHand && (
        <div data-testid="opening-kept-world" style={{ marginTop: 2 }}>
          <div style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6c7588', marginBottom: -2 }}>
            Your kept hand
          </div>
          <HandRow cardWidth={compact ? 88 : 92} overlap={compact ? 46 : 42}>
            {detail.dealtHand.map((c, i) => (
              <QuizCard
                key={`kept-${c.id}-${i}`}
                card={c}
                width={compact ? 88 : 92}
                // YOUR two picks in this world render cyan at full strength —
                // the rest stays dimmed (the timeline that didn't happen).
                verdict={keptWorldPickIdx.has(i) ? 'mine' : undefined}
                dimmed={!keptWorldPickIdx.has(i)}
              />
            ))}
          </HandRow>
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  // Keyboard hints mean nothing on touch — hide them there.
  const coarse = useMediaQuery('(pointer: coarse)');
  if (coarse) return null;
  return (
    <span
      style={{
        marginLeft: 8,
        fontSize: 10.5,
        fontWeight: 700,
        padding: '1px 6px',
        borderRadius: 4,
        border: '1px solid rgba(255,255,255,0.25)',
        color: 'rgba(255,255,255,0.55)',
        verticalAlign: 'middle',
      }}
    >
      {children}
    </span>
  );
}

// On a keep, dealt === kept, so the stage-2 helper copy shouldn't spoil
// anything: only call out "they actually mulliganed" when the hands differ.
// (Comparing by multiset of ids — same rule the server validates with.)
function sameHand(d: Detail): boolean {
  const a = d.dealtHand.map((c) => c.id).sort();
  const b = d.keptHand.map((c) => c.id).sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function RevealPanel({
  teamSlug,
  detail,
  reveal,
  viewerName,
  hasNext,
  onNext,
  response,
  isPractice,
  onRetry,
  onWatch,
}: {
  teamSlug: string;
  detail: Detail;
  reveal: Reveal;
  viewerName: string;
  hasNext: boolean;
  onNext: () => void;
  // The answer the diff is shown against: the stored response, or the
  // throwaway practice answer when this reveal follows a practice run.
  response: { decision: 'keep' | 'mulligan'; resourced: string[] } | null;
  isPractice: boolean;
  onRetry?: () => void;
  onWatch: () => void;
}) {
  const mine = response;
  const decisionMatch = mine ? mine.decision === reveal.decision : null;
  const theirPicks = reveal.resourced.map((c) => c.id);
  const sharedPicks = useMemo(() => {
    if (!mine) return new Set<string>();
    const remaining = [...theirPicks];
    const shared = new Set<string>();
    for (const id of mine.resourced) {
      const at = remaining.indexOf(id);
      if (at >= 0) { remaining.splice(at, 1); shared.add(id); }
    }
    return shared;
  }, [mine, theirPicks]);

  const who = reveal.recorder.name ?? 'Your teammate';
  const keeps = reveal.responses.filter((r) => r.decision === 'keep').length;
  const mulls = reveal.responses.length - keeps;

  return (
    <section data-testid="opening-reveal" style={{ ...promptPanelStyle, position: 'relative' }}>
      <div style={promptTitleStyle}>
        {who} {reveal.decision === 'keep' ? 'kept this hand' : 'mulliganed'}
        {decisionMatch !== null && (
          <span style={{ marginLeft: 10, fontSize: 13, color: decisionMatch ? '#6bd968' : '#ff7b72', fontWeight: 700 }}>
            {decisionMatch ? '— so did you ✓' : `— you said ${mine!.decision} ✗`}
          </span>
        )}
      </div>
      {isPractice && (
        <p data-testid="opening-practice-note" style={{ margin: '6px 0 0', fontSize: 12, color: '#ffb454', textAlign: 'center' }}>
          Practice run — recorded answer{detail.myResponse ? ` (${detail.myResponse.decision})` : ''} unchanged.
        </p>
      )}
      {mine && (
        <p style={{ ...promptTextStyle, margin: '8px 0 0', fontSize: 13 }}>
          {mine.decision === 'keep' && reveal.decision === 'mulligan'
            ? 'Your picks are on your kept hand below — theirs on the redraw.'
            : sharedPicks.size === 2 ? 'Same two picks.' : sharedPicks.size === 1 ? 'One pick matched.' : 'No picks matched.'}
        </p>
      )}

      {/* The resource diff lives ON the hand below (verdict colors) — no
          separate card grid needed here. */}
      <div style={{ display: 'flex', gap: 16, marginTop: 12, justifyContent: 'center', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {reveal.responses.length > 0 && (
          <div style={{ minWidth: 200, textAlign: 'left' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a93a3', marginBottom: 6 }}>
              Team so far — Keep {keeps} · Mulligan {mulls}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {reveal.responses.map((r) => (
                <div key={r.userId} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: '#c8cdd8' }}>
                  <span style={{ fontWeight: 600, minWidth: 110 }}>{r.name ?? 'Teammate'}</span>
                  <span style={{ color: r.decision === reveal.decision ? '#6bd968' : '#ff7b72' }}>{r.decision}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
        <button
          type="button"
          data-testid="opening-watch"
          onClick={onWatch}
          style={{ ...glowButtonStyle, fontSize: 12.5 }}
        >
          ▶ Watch the opening
        </button>
        {onRetry && (
          <button
            type="button"
            data-testid="opening-retry"
            onClick={onRetry}
            style={{ ...glowButtonStyle, fontSize: 12.5, background: 'transparent', boxShadow: 'none', color: '#a0a8b8', borderColor: '#2e333c' }}
          >
            ↺ Redo
          </button>
        )}
        <GradientBorderButton testId="opening-next" onClick={onNext} style={{ padding: '0.55rem 1.2rem' }}>
          {hasNext ? 'Next opening' : 'Finish session'} <Kbd>⏎</Kbd>
        </GradientBorderButton>
      </div>

      <div style={{ marginTop: 14, textAlign: 'left' }}>
        <DisagreeComposer
          teamSlug={teamSlug}
          replaySlug={detail.replaySlug}
          frameIndex={reveal.mulliganFrameIndex}
          recorder={reveal.recorder}
          viewerName={viewerName}
          isOwner={detail.isOwner}
        />
      </div>
    </section>
  );
}

// The discussion hook: a team-scoped tag on the SOURCE replay, anchored at the
// decision frame, auto-@mentioning the uploader — it lands in the existing
// discussion feed + their mentions inbox, no parallel comment system (B221).
function DisagreeComposer({
  teamSlug,
  replaySlug,
  frameIndex,
  recorder,
  viewerName,
  isOwner,
}: {
  teamSlug: string;
  replaySlug: string;
  frameIndex: number;
  recorder: { userId: string | null; name: string | null };
  viewerName: string;
  isOwner: boolean;
}) {
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'posting' | 'posted' | 'error'>('idle');
  if (isOwner) return null; // owners discuss from the feed/viewer — nothing to disagree with

  const post = async () => {
    const comment = text.trim();
    if (!comment) return;
    setState('posting');
    try {
      const res = await fetch(`/api/replays/${replaySlug}/tags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installToken: getOrCreateInstallToken(),
          authorName: viewerName,
          frameIndex,
          comment,
          teamSlugs: [teamSlug],
          ...(recorder.userId ? { mentions: { userIds: [recorder.userId], teamSlugs: [] } } : {}),
        }),
      });
      const j = await res.json();
      setState(j.ok ? 'posted' : 'error');
    } catch {
      setState('error');
    }
  };

  if (state === 'posted') {
    return (
      <div style={{ fontSize: 13, color: '#6bd968' }}>
        Posted{recorder.name ? ` — @${recorder.name} notified.` : '.'}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea
        data-testid="opening-comment"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder={`Disagree? Tell ${recorder.name ?? 'them'} why…`}
        style={{
          width: '100%',
          resize: 'vertical',
          background: '#0d1016',
          border: '1px solid #2e333c',
          borderRadius: tokens.radius.sm,
          color: '#e6e6e6',
          fontFamily: 'inherit',
          fontSize: 13,
          padding: '8px 10px',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          data-testid="opening-post"
          onClick={post}
          disabled={state === 'posting' || !text.trim()}
          style={{ ...glowButtonStyle, fontSize: 12.5, opacity: state === 'posting' || !text.trim() ? 0.6 : 1 }}
        >
          {state === 'posting' ? 'Posting…' : 'Post to team discussion'}
        </button>
        {recorder.name && (
          <span style={{ fontSize: 11.5, color: '#6c7588' }}>@{recorder.name} will be notified</span>
        )}
        {state === 'error' && <span style={{ fontSize: 12, color: '#ff7b72' }}>Failed — try again.</span>}
      </div>
    </div>
  );
}
