// B101/Phase 1 (sibling feature, ADR 0007): per-game, FIRST-PERSON resourcing
// analysis for the recorder. Masking is a non-issue here — we have complete
// info for the recorder, who is exactly the player being rated.
//
// Pure: takes decoded frames + an injected cost lookup (the caller supplies it
// from the catalog), returns a structured report. No DB, no network.
//
// Model (agreed design):
//   • Rounds = action-phase spans (action→regroup transitions).
//   • Each round's float (unspent `availableResources` at round end) is
//     classified by REASON: initiative (claimed initiative & passed — deliberate,
//     excluded from the score), forced-stuck (passed with no play), underspend
//     (played but left capacity), or spent.
//   • The DECIDED round (the final action span) is dropped from regret + the
//     "poor float" tally — floating when the game's ending is noise.
//   • "ever played" is per-cardId (any copy), so a card you played one copy of
//     isn't called dead.
//   • Regret v2, strict (two signals):
//       A) clog — a card HELD in hand ≥2 rounds, never played AND never
//          resourced (pure dead weight), while you floated. Resourcing it was
//          free value. (Your "held an expensive card, never played it" case.)
//       B) buried-and-needed — a forced-stuck float round where a card you
//          resourced earlier (cost ≤ float, never played) would've been a play,
//          AND there was an expendable dead card you could've resourced instead.
//          Only flagged with that alternative present, so we never cry wolf when
//          resourcing was forced.

import type { Frame } from './replayDecoder';
import { cardIdOf } from './statsExtract';

const ZONES = ['deck', 'hand', 'resources', 'groundArena', 'spaceArena', 'discard'] as const;

export interface RoundSummary {
  round: number; // 1-based
  resources: number; // resource-row size at round end
  float: number; // unspent (ready) resources at round end
  reason: 'spent' | 'initiative' | 'forced-stuck' | 'underspend';
  plays: string[]; // cardIds played this round (recorder)
  resourced: string[]; // cardIds resourced this round
  endFrameIndex: number;
  isFinal: boolean;
}

export type RegretFlag =
  | { kind: 'clog'; round: number; frameIndex: number; cardId: string; heldRounds: number; floatedWhileHeld: number; message: string }
  | { kind: 'buried'; round: number; frameIndex: number; cardId: string; cost: number; float: number; alternativeCardId: string; message: string };

export interface ResourcingReport {
  recorderId: string | null;
  username: string | null;
  rounds: RoundSummary[];
  floatTotal: number;
  floatByReason: { initiative: number; forced: number; underspend: number }; // forced/underspend exclude the decided round
  deadCards: { cardId: string; drawnRound: number | null }[]; // drawn, no copy ever played
  flags: RegretFlag[];
  decidedRoundDropped: boolean;
}

export interface AnalyzeOpts {
  recorderId?: string | null;
  costOf: (cardId: string) => number | null;
  nameOf?: (cardId: string) => string;
}

// B101/Phase 3: collapse a per-game report into the numbers that get PERSISTED
// (one recorder row) and aggregated into the resourcing trend. The headline is
// "resource efficiency" = 1 − wasted-float / available-resources over the
// COUNTED rounds (the engine already excludes initiative claims + the decided
// final round from the float buckets; we mirror that for the denominator). We
// store the raw components, not the ratio, so a blended efficiency across games
// is Σwasted/Σavailable — not an average of per-game percentages.
export interface ResourcingRating {
  countedRounds: number;
  available: number; // Σ resource-row size over counted (non-initiative, non-final) rounds
  wasted: number; // forced + underspend float
  forced: number;
  underspend: number;
  deadCards: number;
  efficiency: number | null; // 1 − wasted/available; null when no counted capacity
}

export function summarizeResourcing(report: ResourcingReport): ResourcingRating {
  const counted = report.rounds.filter((r) => !r.isFinal && r.reason !== 'initiative');
  const available = counted.reduce((s, r) => s + r.resources, 0);
  const { forced, underspend } = report.floatByReason;
  const wasted = forced + underspend;
  return {
    countedRounds: counted.length,
    available,
    wasted,
    forced,
    underspend,
    deadCards: report.deadCards.length,
    // Clamp: float can't exceed capacity in real games, but guard against any
    // frame anomaly producing a nonsensical >100% waste.
    efficiency: available > 0 ? Math.max(0, 1 - wasted / available) : null,
  };
}

function inferRecorder(frames: Frame[]): string | null {
  for (const f of frames) for (const pid of Object.keys(f.state?.players || {})) if (((f.state.players[pid].cardPiles?.hand) || []).some((c: any) => cardIdOf(c))) return pid;
  return null;
}

export function analyzeResourcing(frames: Frame[], opts: AnalyzeOpts): ResourcingReport {
  const recorderId = opts.recorderId ?? inferRecorder(frames);
  const username = recorderId ? frames[frames.length - 1]?.state?.players?.[recorderId]?.user?.username ?? null : null;
  const name = (id: string) => (opts.nameOf ? opts.nameOf(id) : id);
  const cost = opts.costOf;

  // Rounds = action-phase spans.
  const rounds: [number, number][] = [];
  let start: number | null = null;
  frames.forEach((f, i) => {
    const ph = f.state?.phase;
    if (ph === 'action' && start === null) start = i;
    else if (ph !== 'action' && start !== null) { rounds.push([start, i - 1]); start = null; }
  });
  if (start !== null) rounds.push([start, frames.length - 1]);
  const nRounds = rounds.length;
  const finalRound = nRounds - 1;
  const frameRound = (i: number) => rounds.findIndex(([a, b]) => i >= a && i <= b);

  const empty: ResourcingReport = { recorderId, username, rounds: [], floatTotal: 0, floatByReason: { initiative: 0, forced: 0, underspend: 0 }, deadCards: [], flags: [], decidedRoundDropped: false };
  if (!recorderId || nRounds === 0) return empty;

  // Recorder card lifecycle by uuid.
  type Life = { cardId: string; drawn?: number; resourced?: number; played?: number; handRounds: Set<number> };
  const life = new Map<string, Life>();
  const lastZone = new Map<string, string>();
  frames.forEach((f, i) => {
    const piles = f.state?.players?.[recorderId]?.cardPiles || {};
    const rd = frameRound(i);
    for (const z of ZONES) {
      for (const c of piles[z] || []) {
        const id = cardIdOf(c); if (!id) continue; const uuid = c.uuid || id;
        if (!life.has(uuid)) life.set(uuid, { cardId: id, handRounds: new Set() });
        const L = life.get(uuid)!;
        if (z === 'hand' && rd >= 0) L.handRounds.add(rd);
        const prev = lastZone.get(uuid); if (prev === z) continue; lastZone.set(uuid, z);
        if (z === 'hand' && (prev === undefined || prev === 'deck') && L.drawn == null) L.drawn = rd;
        if (z === 'resources' && prev === 'hand' && L.resourced == null) L.resourced = rd;
        if ((z === 'groundArena' || z === 'spaceArena') && L.played == null) L.played = rd;
      }
    }
  });
  const everPlayed = new Set([...life.values()].filter((l) => l.played != null).map((l) => l.cardId));
  const isDead = (cardId: string) => !everPlayed.has(cardId);

  // Rounds the recorder claimed initiative (from the log).
  const initRounds = new Set<number>();
  frames.forEach((f, i) => {
    for (const m of f.state?.newMessages || []) {
      const txt = Array.isArray(m.message) ? m.message.map((x: any) => (typeof x === 'string' ? x : x?.name || '')).join('') : '';
      if (/claims initiative and passes/i.test(txt) && username && txt.includes(username)) initRounds.add(frameRound(i));
    }
  });

  const roundSummaries: RoundSummary[] = rounds.map(([, b], ri) => {
    const end = frames[b].state.players[recorderId];
    const float = end?.availableResources ?? 0;
    const resources = (end?.cardPiles?.resources || []).length;
    const plays = [...life.values()].filter((l) => l.played === ri).map((l) => l.cardId);
    const resourced = [...life.values()].filter((l) => l.resourced === ri).map((l) => l.cardId);
    const init = initRounds.has(ri);
    const reason: RoundSummary['reason'] = init ? 'initiative' : float === 0 ? 'spent' : plays.length === 0 ? 'forced-stuck' : 'underspend';
    return { round: ri + 1, resources, float, reason, plays, resourced, endFrameIndex: b, isFinal: ri === finalRound };
  });

  let floatTotal = 0;
  const byReason = { initiative: 0, forced: 0, underspend: 0 };
  roundSummaries.forEach((r, ri) => {
    floatTotal += r.float;
    if (r.reason === 'initiative') byReason.initiative += r.float;
    else if (ri !== finalRound) {
      if (r.reason === 'forced-stuck') byReason.forced += r.float;
      else if (r.reason === 'underspend') byReason.underspend += r.float;
    }
  });

  const deadByCardId = new Map<string, number | null>();
  for (const l of life.values()) if (l.drawn != null && isDead(l.cardId) && !deadByCardId.has(l.cardId)) deadByCardId.set(l.cardId, l.drawn);
  const deadCards = [...deadByCardId.entries()].map(([cardId, dr]) => ({ cardId, drawnRound: dr != null ? dr + 1 : null }));

  const flags: RegretFlag[] = [];
  // Signal A — clog (one per dead cardId).
  const clogged = new Set<string>();
  for (const L of life.values()) {
    if (L.played != null || L.resourced != null || !isDead(L.cardId) || clogged.has(L.cardId)) continue;
    const hand = [...L.handRounds].filter((r) => r >= 0).sort((a, b) => a - b);
    if (hand.length < 2) continue;
    const first = hand[0]; const last = hand[hand.length - 1];
    const floatedWhileHeld = roundSummaries.filter((r, ri) => ri >= first && ri <= last && ri !== finalRound && r.reason !== 'initiative').reduce((s, r) => s + r.float, 0);
    if (floatedWhileHeld < 1) continue;
    clogged.add(L.cardId);
    flags.push({ kind: 'clog', round: first + 1, frameIndex: rounds[first][0], cardId: L.cardId, heldRounds: last - first + 1, floatedWhileHeld, message: `Held ${name(L.cardId)} from R${first + 1} for ${last - first + 1} rounds — never played it, and floated ${floatedWhileHeld} resources while it sat. Resourcing it would've turned dead weight into resources.` });
  }
  // Signal B — buried-and-needed (strict: forced-stuck float + buried-fit card + an expendable alternative).
  roundSummaries.forEach((r, ri) => {
    if (ri === finalRound || r.reason !== 'forced-stuck' || r.float < 1) return;
    const buried = [...life.values()]
      .filter((l) => l.resourced != null && l.resourced < ri && isDead(l.cardId) && cost(l.cardId) != null && cost(l.cardId)! <= r.float)
      .sort((a, b) => cost(b.cardId)! - cost(a.cardId)!)[0];
    if (!buried) return;
    const alt = [...life.values()].find((l) => l.played == null && l.resourced == null && isDead(l.cardId) && l.drawn != null && l.drawn <= ri && l.cardId !== buried.cardId);
    if (!alt) return;
    flags.push({ kind: 'buried', round: ri + 1, frameIndex: r.endFrameIndex, cardId: buried.cardId, cost: cost(buried.cardId)!, float: r.float, alternativeCardId: alt.cardId, message: `R${ri + 1}: floated ${r.float} with no play. You resourced ${name(buried.cardId)} (cost ${cost(buried.cardId)}) on R${buried.resourced! + 1} and never played it — resourcing ${name(alt.cardId)} instead would've kept ${name(buried.cardId)} castable here.` });
  });

  return { recorderId, username, rounds: roundSummaries, floatTotal, floatByReason: byReason, deadCards, flags, decidedRoundDropped: true };
}
