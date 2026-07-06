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

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardImageUrl } from '@/lib/cardImage';
import { LeaderBasePair } from '@/app/_components/LeaderBasePair';
import { ErrorNote, Loading } from '@/app/_components/StatusUi';
import { glowButtonStyle } from '@/app/_components/glowButton';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { getOrCreateInstallToken } from '@/lib/installToken';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { OpeningWatchModal, prepareWatch } from './OpeningWatchModal';
import { MentionInput, type MentionData } from '@/app/(app)/r/[slug]/MentionInput';
import {
  GradientBorderButton,
  HandRow,
  InitiativePill,
  QuizCard,
  SeatCard,
  promptPanelStyle,
  promptTextStyle,
  promptTitleStyle,
  VERDICT_STYLE,
  type QuizCardRef,
  type PickVerdict,
} from './OpeningPromptKit';

interface ResponseView {
  userId: string;
  name: string | null;
  decision: 'keep' | 'mulligan';
  resourced: string[];
  isMine: boolean;
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
  finishLabel = 'Finish session',
}: {
  teamSlug: string;
  replaySlug: string;
  viewerName: string;
  // Whether the session has another opening after this one (Next vs Finish).
  hasNext: boolean;
  // Fired once when a response lands: (slug, agreedWithRecordedDecision).
  onAnswered: (slug: string, agreed: boolean) => void;
  onNext: () => void;
  // The last-item button label — "Finish session" in a session, "Done" when
  // revisiting a single opening (no session framing).
  finishLabel?: string;
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

  // The picking hand — stage 2 follows YOUR decision (keep → dealt, mulligan
  // → the redraw, which == dealt when the recorder kept). The reveal is a
  // separate full page (no board), so nothing paints on this hand anymore.
  const hand = stage === 'mulligan' ? detail.dealtHand : myMulligan === 'keep' ? detail.dealtHand : detail.keptHand;
  const seatLabel = detail.isOwner ? 'You' : 'Your seat';
  const kept = sameHand(detail); // did the recorder keep? (a keep can't change cards)

  const startPractice = () => {
    setPracticing(true);
    setPractice(null);
    setMyMulligan(null);
    setPicks([]);
    setStage('mulligan');
  };

  // The picking hand — the full-width bottom row, like sitting at the table.
  const fanW = compact ? 132 : 150;
  const fan = (
    <HandRow cardWidth={fanW} overlap={compact ? 56 : -10}>
      {hand.map((c, i) => (
        <QuizCard
          key={`${c.id}-${i}`}
          testId={stage === 'resource' ? `opening-pick-${i}` : undefined}
          card={c}
          width={fanW}
          selectable={stage === 'resource' ? true : undefined}
          selected={stage === 'resource' ? picks.includes(i) : undefined}
          onClick={stage === 'resource' ? () => togglePick(i) : undefined}
        />
      ))}
    </HandRow>
  );

  // ONE layout for every screen size — the karabast table, scaled: the
  // center column (their leader/base above yours) dead-center, the hand
  // across the bottom, and ALL interaction floating OVER the board like the
  // game's own prompt popups. The Initiative pill hangs off the holder's
  // leader card.
  const seatW = compact ? 124 : 168;
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: compact ? 8 : 10 }}>
      <div style={{ position: 'relative' }}>
        <SeatCard testId="opening-seat-opp" kind="leader" card={detail.oppLeader} label="Opponent" width={seatW} />
        {detail.wentFirst === false && pillAt('opp')}
      </div>
      <SeatCard kind="base" card={detail.oppBase} width={seatW} />
      <div style={{ height: compact ? 10 : 18 }} />
      <SeatCard kind="base" card={detail.ownBase} width={seatW} />
      <div style={{ position: 'relative' }}>
        <SeatCard testId="opening-seat-own" kind="leader" card={detail.ownLeader} label={seatLabel} width={seatW} />
        {detail.wentFirst === true && pillAt('own')}
      </div>
    </div>
  );

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
        style={{ pointerEvents: 'auto', width: 'min(520px, 100%)', minHeight: 0, maxHeight: '100%', overflowY: 'auto', filter: 'drop-shadow(0 18px 50px rgba(0,0,0,0.8))' }}
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
      </div>
    </div>
  );

  // Once the picks are in, the board goes away entirely — the reveal is a
  // full-width RESULT PAGE that uses all the room to compare hands clearly.
  if (stage === 'reveal' && detail.reveal) {
    return (
      <div data-testid="opening-stage" style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, flex: 1 }}>
        <MatchupHeader detail={detail} recorderName={detail.reveal.recorder.name} />
        <RevealPanel
          teamSlug={teamSlug}
          detail={detail}
          reveal={detail.reveal}
          viewerName={viewerName}
          hasNext={hasNext}
          onNext={onNext}
          finishLabel={finishLabel}
          response={practice ?? detail.myResponse}
          isPractice={!!practice}
          onRetry={detail.isOwner ? undefined : startPractice}
          onWatch={() => setWatching(true)}
        />
        {watching && (
          <OpeningWatchModal
            replaySlug={detail.replaySlug}
            startFrame={detail.reveal.mulliganFrameIndex}
            onClose={() => setWatching(false)}
          />
        )}
      </div>
    );
  }

  // Picking stages: the karabast table — board + floating prompt + your hand.
  return (
    <div
      data-testid="opening-stage"
      style={{ display: 'flex', flexDirection: 'column', gap: compact ? 10 : 14, minWidth: 0, flex: 1 }}
    >
      <div style={{ position: 'relative' }}>
        {board}
        {overlay}
      </div>
      {fan}
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

// Per-member RESOURCE SUMMARY (B221): each participant's opening as ONE hand
// of six, with the two cards they resourced lifted up and colored by how they
// match YOUR picks (green = you both took it, yellow = they took it and you
// didn't, cyan = it's your own pick). Layout: the uploader and you side by
// side up top (the two anchors), the rest of the team in a grid below.
interface MemberRecord {
  key: string;
  name: string | null;
  decision: 'keep' | 'mulligan';
  hand: QuizCardRef[]; // the full six they picked from
  resourcedIdx: Set<number>; // which of the six were resourced
  verdictByIdx: Map<number, PickVerdict>; // color per resourced card, vs your picks
  tone: 'recorder' | 'viewer' | 'other';
}

function MemberPicks({
  responses,
  dealtHand,
  keptHand,
  recorder,
  viewerResponse,
}: {
  responses: ResponseView[];
  dealtHand: QuizCardRef[];
  keptHand: QuizCardRef[];
  recorder: { name: string | null; decision: 'keep' | 'mulligan'; resourced: QuizCardRef[] };
  // The viewer's EFFECTIVE answer (practice run overrides the stored one), or
  // null when the viewer is the uploader and never answered.
  viewerResponse: { decision: 'keep' | 'mulligan'; resourced: string[] } | null;
}) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<MemberRecord | null>(null);

  const holdsBoth = (hand: QuizCardRef[], picks: string[]) => {
    const pool = hand.map((c) => c.id);
    for (const id of picks) { const at = pool.indexOf(id); if (at < 0) return false; pool.splice(at, 1); }
    return true;
  };
  const sourceHand = (decision: 'keep' | 'mulligan', picks: string[]) => {
    const primary = decision === 'keep' ? dealtHand : keptHand;
    const other = decision === 'keep' ? keptHand : dealtHand;
    return holdsBoth(primary, picks) ? primary : holdsBoth(other, picks) ? other : primary;
  };
  const resourcedIndices = (hand: QuizCardRef[], picks: string[]) => {
    const pool = [...picks];
    const set = new Set<number>();
    hand.forEach((c, i) => { const at = pool.indexOf(c.id); if (at >= 0) { pool.splice(at, 1); set.add(i); } });
    return set;
  };

  // Your picks are the comparison reference; the uploader falls back to their own.
  const referencePicks = viewerResponse?.resourced ?? recorder.resourced.map((c) => c.id);

  const buildVerdicts = (hand: QuizCardRef[], idx: Set<number>, tone: MemberRecord['tone']) => {
    const map = new Map<number, PickVerdict>();
    if (tone === 'viewer') { idx.forEach((i) => map.set(i, 'mine')); return map; }
    const pool = [...referencePicks];
    [...idx].sort((a, b) => a - b).forEach((i) => {
      const at = pool.indexOf(hand[i].id);
      if (at >= 0) { pool.splice(at, 1); map.set(i, 'match'); } else { map.set(i, 'theirs'); }
    });
    return map;
  };

  const makeRecord = (key: string, name: string | null, decision: 'keep' | 'mulligan', picks: string[], hand: QuizCardRef[], tone: MemberRecord['tone']): MemberRecord => {
    const idx = resourcedIndices(hand, picks);
    return { key, name, decision, hand, resourcedIdx: idx, verdictByIdx: buildVerdicts(hand, idx, tone), tone };
  };

  const recorderRec = makeRecord('__recorder__', recorder.name, recorder.decision, recorder.resourced.map((c) => c.id), keptHand, 'recorder');
  const viewerRec = viewerResponse ? makeRecord('__you__', 'You', viewerResponse.decision, viewerResponse.resourced, sourceHand(viewerResponse.decision, viewerResponse.resourced), 'viewer') : null;
  // Everyone else — the viewer's own stored response is already shown as the
  // "you" block above, so drop it here.
  const others = responses.filter((r) => !r.isMine).map((r) => makeRecord(r.userId, r.name, r.decision, r.resourced, sourceHand(r.decision, r.resourced), 'other'));

  const decisionMatch = viewerRec ? viewerRec.decision === recorderRec.decision : null;

  return (
    <div data-testid="opening-member-picks" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* THE RESULT: your full end state next to the uploader's, side by side. */}
      {decisionMatch !== null && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, border: `1px solid ${decisionMatch ? '#00E25B' : '#66E5FF'}`, color: decisionMatch ? '#6bd968' : '#66E5FF' }}>You {viewerRec!.decision}</span>
          <span style={{ color: decisionMatch ? '#6bd968' : '#ff7b72', fontWeight: 800, fontSize: 13 }}>{decisionMatch ? '✓' : '✗'}</span>
          <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, border: `1px solid ${decisionMatch ? '#00E25B' : '#ff7b72'}`, color: decisionMatch ? '#6bd968' : '#ff7b72' }}>{recorderRec.name ?? 'Recorder'} {recorderRec.decision}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {viewerRec && <MemberBlock rec={viewerRec} onView={() => setViewing(viewerRec)} grow />}
        <MemberBlock rec={recorderRec} onView={() => setViewing(recorderRec)} grow />
      </div>

      {/* The rest of the team, behind a toggle. */}
      {others.length > 0 && (
        <div>
          <button
            type="button"
            data-testid="opening-member-picks-toggle"
            onClick={() => setOpen((v) => !v)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: '#8a93a3', fontFamily: 'inherit', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', padding: 0 }}
          >
            Rest of the team · {others.length}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {open && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, marginTop: 8 }}>
              {others.map((rec) => (
                <MemberBlock key={rec.key} rec={rec} onView={() => setViewing(rec)} />
              ))}
            </div>
          )}
        </div>
      )}
      {viewing && <HandPreview rec={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function MemberBlock({ rec, onView, grow }: { rec: MemberRecord; onView: () => void; grow?: boolean }) {
  const compact = useMediaQuery('(max-width: 860px)');
  const tint = rec.tone === 'recorder'
    ? { background: 'rgba(0,226,91,0.06)', border: '1px solid rgba(0,226,91,0.35)' }
    : rec.tone === 'viewer'
      ? { background: 'rgba(102,229,255,0.06)', border: '1px solid rgba(102,229,255,0.35)' }
      : { background: 'rgba(255,255,255,0.03)', border: '1px solid #2e333c' };
  const suffix = rec.tone === 'recorder' ? `· recorded ${rec.decision}` : `· ${rec.decision}`;
  const nameText = rec.tone === 'viewer' ? 'You' : rec.name ?? (rec.tone === 'recorder' ? 'Recorder' : 'Teammate');
  return (
    <div
      data-testid={rec.tone === 'recorder' ? 'opening-member-recorder' : rec.tone === 'viewer' ? 'opening-member-you' : undefined}
      style={{ ...tint, display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', borderRadius: 8, ...(grow ? { flex: '1 1 460px', minWidth: 0 } : {}) }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: '#e6ebf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nameText} <span style={{ color: rec.tone === 'recorder' ? '#6bd968' : rec.tone === 'viewer' ? '#66E5FF' : '#6c7588', fontWeight: rec.tone === 'other' ? 400 : 700 }}>{suffix}</span>
        </span>
        <button
          type="button"
          data-testid="opening-member-view"
          aria-label={`View ${nameText} full size`}
          onClick={onView}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, background: 'transparent', border: 'none', color: '#6c7588', cursor: 'pointer', padding: 0, flexShrink: 0 }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#e6e6e6'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#6c7588'; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
      <TeamHand rec={rec} width={compact ? 52 : 76} spread={compact ? -26 : 6} mini />
    </div>
  );
}

// One hand of six, resourced cards lifted and colored (verdict) vs your picks.
// `spread` is the gap between cards: positive spaces them out (no overlap),
// negative overlaps (mobile). SCALES TO FIT its container so a hand never
// spills out of its grid cell. `mini` (the small grid): no verdict text + soft
// glow; full-size keeps both.
function TeamHand({ rec, width, spread, mini }: { rec: MemberRecord; width: number; spread: number; mini?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const n = rec.hand.length;
  const natural = width * n + spread * (n - 1); // full row width at 1:1
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / (natural + 4)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [natural]);
  const naturalH = width * 1.4 + 14 /* lift */ + 18 /* paddingTop */;
  return (
    <div ref={ref} style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', height: naturalH * scale, overflow: 'hidden' }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top center', display: 'flex', alignItems: 'flex-end', paddingTop: 18 }}>
        {rec.hand.map((c, i) => {
          const isR = rec.resourcedIdx.has(i);
          return (
            <div
              key={`${c.id}-${i}`}
              data-testid={isR ? 'opening-member-pick' : undefined}
              style={{ marginLeft: i === 0 ? 0 : spread, zIndex: isR ? 30 : i, transform: isR ? 'translateY(-14px)' : 'none' }}
            >
              <QuizCard card={c} width={width} verdict={rec.verdictByIdx.get(i)} noPreview mini={mini} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The full-size view (eye click): the same six-card hand, large.
function HandPreview({ rec, onClose }: { rec: MemberRecord; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  const nameText = rec.tone === 'viewer' ? 'You' : rec.name ?? (rec.tone === 'recorder' ? 'Recorder' : 'Teammate');
  return createPortal(
    <div
      data-testid="opening-hand-preview"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(6,8,12,0.6)', padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ ...promptPanelStyle, position: 'relative', padding: '16px 20px', maxWidth: '95vw', display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 20px 70px rgba(0,0,0,0.85)' }}>
        <button
          type="button"
          data-testid="opening-hand-preview-close"
          aria-label="Close"
          onClick={onClose}
          style={{ position: 'absolute', top: 8, right: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: 'transparent', border: 'none', color: '#a0a8b8', cursor: 'pointer', padding: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
        </button>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#e6ebf2', textAlign: 'center', padding: '0 24px' }}>
          {nameText}
          <span style={{ color: rec.tone === 'recorder' ? '#6bd968' : rec.tone === 'viewer' ? '#66E5FF' : '#a0a8b8', fontWeight: 600 }}> · {rec.tone === 'recorder' ? `recorded ${rec.decision}` : rec.decision}</span>
        </div>
        <div style={{ overflowX: 'auto', maxWidth: '92vw' }}>
          <TeamHand rec={rec} width={110} spread={8} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// The reveal's matchup header: horizontal, leader overlapping its base to save
// vertical space (the board is gone). Recorder's deck vs the opponent's, with
// who had initiative.
function MatchupHeader({ detail, recorderName }: { detail: Detail; recorderName: string | null }) {
  const compact = useMediaQuery('(max-width: 860px)');
  const w = compact ? 108 : 168;
  const Side = ({ leader, base, label, initiative, align }: { leader: any; base: any; label: string; initiative: boolean; align: 'left' | 'right' }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexDirection: align === 'right' ? 'row-reverse' : 'row', minWidth: 0 }}>
      <LeaderBasePair leader={leader} base={base} orientation="overlap" reverse={align === 'right'} width={w} height={Math.round(w / 1.4)} fit="cover" radius={8} fallback="hide" />
      <div style={{ minWidth: 0, textAlign: align }}>
        <div style={{ fontSize: compact ? 15 : 19, fontWeight: 800, color: '#e6ebf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
        <div style={{ fontSize: compact ? 12.5 : 14.5, color: '#8a93a3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {(leader?.name as string) || 'Unknown'}
        </div>
        {initiative && <div style={{ fontSize: compact ? 11 : 12, color: '#00BAFF', fontWeight: 800, letterSpacing: '0.04em', marginTop: 2 }}>INITIATIVE</div>}
      </div>
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: compact ? 18 : 40, flexWrap: 'wrap', padding: '6px 0 10px' }}>
      <Side leader={detail.ownLeader} base={detail.ownBase} label={recorderName ?? 'Recorder'} initiative={detail.wentFirst === true} align="left" />
      <span style={{ fontSize: compact ? 13 : 16, fontWeight: 800, letterSpacing: '0.1em', color: '#6c7588' }}>VS</span>
      <Side leader={detail.oppLeader} base={detail.oppBase} label="Opponent" initiative={detail.wentFirst === false} align="right" />
    </div>
  );
}

function RevealPanel({
  teamSlug,
  detail,
  reveal,
  viewerName,
  hasNext,
  onNext,
  finishLabel,
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
  finishLabel: string;
  // The answer the diff is shown against: the stored response, or the
  // throwaway practice answer when this reveal follows a practice run.
  response: { decision: 'keep' | 'mulligan'; resourced: string[] } | null;
  isPractice: boolean;
  onRetry?: () => void;
  onWatch: () => void;
}) {
  const mine = response;
  const keeps = reveal.responses.filter((r) => r.decision === 'keep').length;
  const mulls = reveal.responses.length - keeps;

  return (
    <section data-testid="opening-reveal" style={{ width: '100%', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {isPractice && (
        <p data-testid="opening-practice-note" style={{ margin: '0 0 8px', fontSize: 12, color: '#ffb454', textAlign: 'center' }}>
          Practice run — recorded answer{detail.myResponse ? ` (${detail.myResponse.decision})` : ''} unchanged.
        </p>
      )}

      {/* THE RESULT: your full end state next to the uploader's, side by side —
          reads at a glance, no prose. The uploader (no answer) just sees the
          recorded hand. */}
      <MemberPicks
        responses={reveal.responses}
        dealtHand={detail.dealtHand}
        keptHand={detail.keptHand}
        recorder={{ name: reveal.recorder.name, decision: reveal.decision, resourced: reveal.resourced }}
        viewerResponse={mine}
      />

      {reveal.responses.length > 0 && (
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a93a3', textAlign: 'center', marginTop: 10 }}>
          Team · Keep {keeps} · Mulligan {mulls}
        </div>
      )}

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
          {hasNext ? 'Next opening' : finishLabel} <Kbd>⏎</Kbd>
        </GradientBorderButton>
      </div>

      <div style={{ marginTop: 14, textAlign: 'left' }}>
        <OpeningDiscussion
          teamSlug={teamSlug}
          replaySlug={detail.replaySlug}
          decisionFrames={[reveal.mulliganFrameIndex, reveal.resourceFrameIndex]}
          composeFrame={reveal.mulliganFrameIndex}
          recorder={reveal.recorder}
          viewerName={viewerName}
          isOwner={detail.isOwner}
        />
      </div>
    </section>
  );
}

// The opening's discussion: every tag anchored at its decision frames —
// visible on the reveal so a comment you (or a teammate) left is still there
// when you reopen the item — plus the composer.
function OpeningDiscussion({
  teamSlug,
  replaySlug,
  decisionFrames,
  composeFrame,
  recorder,
  viewerName,
  isOwner,
}: {
  teamSlug: string;
  replaySlug: string;
  decisionFrames: number[];
  composeFrame: number;
  recorder: { userId: string | null; name: string | null };
  viewerName: string;
  isOwner: boolean;
}) {
  const [comments, setComments] = useState<any[] | null>(null);
  const load = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/replays/${replaySlug}/tags`)).json();
      if (j.ok && Array.isArray(j.data)) {
        setComments(j.data.filter((t: any) => decisionFrames.includes(t.frameIndex)));
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaySlug, decisionFrames.join(',')]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {comments && comments.length > 0 && (
        <div data-testid="opening-comments" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a93a3' }}>
            Discussion · {comments.length}
          </div>
          {comments.map((t) => (
            <div key={t.id} style={{ display: 'flex', gap: 8, fontSize: 12.5, alignItems: 'baseline' }}>
              <span style={{ fontWeight: 700, color: '#c8cdd8', flexShrink: 0 }}>{t.authorName ?? 'Teammate'}</span>
              <span style={{ color: '#a0a8b8', minWidth: 0, overflowWrap: 'anywhere' }}>{t.comment}</span>
              {t.createdAt && (
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#6c7588', flexShrink: 0 }}>
                  {new Date(t.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <DisagreeComposer
        teamSlug={teamSlug}
        replaySlug={replaySlug}
        frameIndex={composeFrame}
        recorder={recorder}
        viewerName={viewerName}
        isOwner={isOwner}
        onPosted={load}
      />
    </div>
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
  onPosted,
}: {
  teamSlug: string;
  replaySlug: string;
  frameIndex: number;
  recorder: { userId: string | null; name: string | null };
  viewerName: string;
  isOwner: boolean;
  onPosted?: () => void;
}) {
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'posting' | 'posted' | 'error'>('idle');
  // The canonical @-autocomplete (MentionInput, same as the tag composers).
  // Lazily fetched once per composer; selections accumulate structured
  // mentions — the server never parses free text.
  const [mentionData, setMentionData] = useState<MentionData | null>(null);
  const [draftMentions, setDraftMentions] = useState<{ userIds: string[]; teamSlugs: string[] }>({ userIds: [], teamSlugs: [] });
  useEffect(() => {
    if (isOwner) return;
    let live = true;
    fetch('/api/me/teams-mention-data')
      .then((r) => r.json())
      .then((b) => { if (live && b?.ok) setMentionData({ teams: b.teams ?? [], members: b.members ?? [] }); })
      .catch(() => {});
    return () => { live = false; };
  }, [isOwner]);
  if (isOwner) return null; // owners discuss from the feed/viewer — nothing to disagree with

  const addMention = (kind: 'user' | 'team', id: string) =>
    setDraftMentions((m) => (kind === 'user'
      ? { ...m, userIds: [...new Set([...m.userIds, id])] }
      : { ...m, teamSlugs: [...new Set([...m.teamSlugs, id])] }));

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
          // Deliberately NO auto-mention (default = no notification).
          // Autocomplete-picked @mentions ride the normal machinery (inbox +
          // discord ping); the uploader otherwise finds feedback via the
          // with-comments filter.
          ...(draftMentions.userIds.length || draftMentions.teamSlugs.length ? { mentions: draftMentions } : {}),
        }),
      });
      const j = await res.json();
      if (j.ok) {
        setText('');
        setDraftMentions({ userIds: [], teamSlugs: [] });
        setState('posted');
        onPosted?.(); // the list above refreshes with the new comment
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <MentionInput
        value={text}
        onChange={setText}
        onMention={addMention}
        mentionData={mentionData}
        rows={2}
        placeholder={`Disagree? Tell ${recorder.name ?? 'them'} why… (@ to notify)`}
        onSubmit={post}
        textareaStyle={{
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
        textareaProps={{ 'data-testid': 'opening-comment' } as any}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          data-testid="opening-post"
          onClick={post}
          disabled={state === 'posting' || !text.trim()}
          style={{ ...glowButtonStyle, fontSize: 12.5, opacity: state === 'posting' || !text.trim() ? 0.6 : 1 }}
        >
          {state === 'posting' ? 'Posting…' : 'Post'}
        </button>
        {state === 'posted' && (
          <span data-testid="opening-posted-note" style={{ fontSize: 12, color: '#6bd968' }}>
            Posted.
          </span>
        )}
        {state === 'error' && <span style={{ fontSize: 12, color: '#ff7b72' }}>Failed — try again.</span>}
      </div>
    </div>
  );
}
