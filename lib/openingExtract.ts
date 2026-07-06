// B221: pure extraction of a replay's OPENING — the recorder's setup-phase
// decision slice: the dealt hand at the mulligan prompt, the post-decision
// hand, and the two cards resourced. Feeds the Team Opening Drills pool.
//
// Only the recorder's side is extractable (opponent hands are HIDDEN sentinels
// by construction — see statsExtract's masking invariant). One opening per
// replay, or null when the recording has no usable setup (started mid-game,
// ambiguous capture, encrypted payload decoded elsewhere).
//
// Detection model — PILES FIRST, LOG AS FALLBACK (revised from the original
// B217 log-based plan after a prod-payload audit): real captures often MISS
// the recorder's own decision line (karabast batches state pushes; several
// audited replays carried only the opponent's line, or no setup log at all),
// but the pile data is always complete. Hand IDENTITY across setup is
// decisive: a keep never changes the hand's card uuids between the deal and
// the resource prompt; a mulligan replaces them (bottom + reshuffle + redraw
// 6). So:
//   • The RESOURCE move is a pile transition: the recorder's resources pile
//     reaching 2 during setup (last such transition wins — undo-safe). The
//     hand it was picked from is the prior frame's hand.
//   • The DEALT hand is the first full (6 named cards) recorder hand before
//     the resource move. When the capture includes a pre-deal frame (empty
//     hand — the normal case, recording starts in the lobby), that anchor is
//     certain.
//   • The DECISION is the uuid-multiset comparison dealt vs pre-resource:
//     identical → keep; different → mulligan.
//   • Only when the capture starts mid-setup (no pre-deal frame) and the
//     hands compare identical is "keep" ambiguous with "capture started
//     post-mulligan" — then the game log (delta-matched vs the prior frame,
//     cumulative-log safe; exact karabast text "will mulligan" / "will keep
//     their hand") breaks the tie, else we conservatively return null.
//   • wentFirst: `hasInitiative` is set on a player during setup, before the
//     mulligan (verified against real payloads) — captured for quiz context.
//
// Frame indices are in ORIGINAL frame space (decodeReplay output, uncollapsed)
// — the same space tags and clips pin to; `?f=N` viewer links are index+1.
// mulliganFrameIndex is the dealt-hand frame (the mulligan-prompt moment);
// resourceFrameIndex is the frame where the two resources are visible.

import type { DecodedReplay } from './replayDecoder';
import { cardIdOf } from './statsExtract';

export const OPENING_EXTRACTOR_VERSION = 2;

const HAND_SIZE = 6; // SWU deals exactly 6

export interface OpeningFacts {
  recorderId: string;
  username: string | null;
  decision: 'keep' | 'mulligan';
  dealtHand: string[]; // cardIds (SET_NNN) shown at the mulligan prompt, display order
  keptHand: string[]; // the hand the resources were picked from (== dealtHand on keep)
  resourced: string[]; // exactly 2 cardIds, a multiset (duplicate copies are interchangeable)
  mulliganFrameIndex: number; // the dealt-hand frame — the mulligan-prompt moment
  resourceFrameIndex: number; // frame where the 2 resources landed in the pile
  wentFirst: boolean | null; // recorder held initiative during setup; null if never visible
}

const MULLIGAN_RE = /\bwill mulligan\b/i;
const KEEP_RE = /\bwill keep their hand\b/i;

// Every string anywhere inside a log entry (string parts, {type:'player',name},
// nested alert text). Depth-capped — log entries are tiny. Same shape-agnostic
// walk as actionStops.ts (B217).
function collectStrings(v: any, out: string[], depth = 0): void {
  if (depth > 6 || v == null) return;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out, depth + 1);
  else if (typeof v === 'object') for (const k of Object.keys(v)) collectStrings(v[k], out, depth + 1);
}

function frameMessages(frame: any): any[] {
  const msgs = frame?.state?.newMessages;
  return Array.isArray(msgs) ? msgs : [];
}

// Messages present on this frame but not the prior one (keyed by stable
// serialization) — the cumulative-log guard.
function newMessageTexts(frame: any, prevFrame: any): string[] {
  const cur = frameMessages(frame);
  if (cur.length === 0) return [];
  const prevKeys = new Set(frameMessages(prevFrame).map((m) => JSON.stringify(m)));
  const texts: string[] = [];
  for (const m of cur) {
    if (prevKeys.has(JSON.stringify(m))) continue;
    const parts: string[] = [];
    collectStrings(m, parts);
    texts.push(parts.join(' '));
  }
  return texts;
}

function hand(frame: any, pid: string): any[] {
  const list = frame?.state?.players?.[pid]?.cardPiles?.hand;
  return Array.isArray(list) ? list : [];
}

function pile(frame: any, pid: string, zone: string): any[] {
  const list = frame?.state?.players?.[pid]?.cardPiles?.[zone];
  return Array.isArray(list) ? list : [];
}

const namedIds = (cards: any[]): string[] =>
  cards.map((c) => cardIdOf(c)).filter((id): id is string => id != null);

// Identity key per card instance — uuid when present (stable across setup;
// hidden-zone uuid randomization is per-viewer, irrelevant within one
// recording), cardId as a fallback.
const identityKey = (c: any): string | null => c?.uuid ?? cardIdOf(c);

function sameHandIdentity(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false;
  const ka = a.map(identityKey).sort();
  const kb = b.map(identityKey).sort();
  return ka.every((k, i) => k != null && k === kb[i]);
}

function inferRecorder(frames: { state: any }[]): string | null {
  for (const frame of frames) {
    const players = frame.state?.players;
    if (!players || typeof players !== 'object') continue;
    for (const pid of Object.keys(players)) {
      const h = players[pid]?.cardPiles?.hand;
      if (Array.isArray(h) && h.some((c) => cardIdOf(c))) return pid;
    }
  }
  return null;
}

function usernameOf(frames: { state: any }[], pid: string): string | null {
  for (const f of frames) {
    const p = f.state?.players?.[pid];
    const u = p?.user?.username ?? p?.name;
    if (typeof u === 'string' && u.length > 0) return u;
  }
  return null;
}

export function extractOpening(
  decoded: Pick<DecodedReplay, 'frames' | 'meta'>,
): OpeningFacts | null {
  const frames = decoded.frames || [];
  if (frames.length === 0) return null;

  // Setup span: everything before the first 'action' frame. The transition
  // frame itself is included in the scan — the resource move can land on the
  // same frame the phase flips.
  let setupEnd = -1;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i]?.state?.phase === 'action') { setupEnd = i; break; }
  }
  if (setupEnd < 0) return null; // setup never completed on this recording
  const sawSetup = frames.slice(0, setupEnd).some((f) => f?.state?.phase === 'setup');
  if (!sawSetup) return null; // recording started mid-game

  const metaRid = decoded.meta?.localPlayerId;
  const recorderId =
    (typeof metaRid === 'string' && frames.some((f) => f.state?.players?.[metaRid]) ? metaRid : null) ??
    inferRecorder(frames);
  if (!recorderId) return null;
  const username = usernameOf(frames, recorderId);

  // The resource move: last frame in the span where the recorder's resource
  // pile reaches 2 (an undo can bounce it back below — last transition wins).
  let resourceFrameIndex = -1;
  for (let i = 1; i <= setupEnd; i++) {
    const before = pile(frames[i - 1], recorderId, 'resources').length;
    const after = pile(frames[i], recorderId, 'resources').length;
    if (before < 2 && after >= 2) resourceFrameIndex = i;
  }
  if (resourceFrameIndex < 0) return null;
  const resourced = namedIds(pile(frames[resourceFrameIndex], recorderId, 'resources'));
  if (resourced.length !== 2) return null; // setup resources exactly 2; masked → not our POV

  // The hand the resources were picked from = the frame just before the move.
  const keptCards = hand(frames[resourceFrameIndex - 1], recorderId);
  const keptHand = namedIds(keptCards);
  if (keptHand.length !== HAND_SIZE) return null;

  // The dealt hand: first full recorder hand before the resource move, and
  // whether the capture also shows the pre-deal moment (empty hand) — the
  // anchor that makes it certainly the DEALT hand and not a post-mulligan
  // redraw caught mid-capture.
  let dealtFrameIndex = -1;
  for (let i = 0; i < resourceFrameIndex; i++) {
    if (namedIds(hand(frames[i], recorderId)).length === HAND_SIZE) { dealtFrameIndex = i; break; }
  }
  if (dealtFrameIndex < 0) return null;
  const sawPreDeal = frames
    .slice(0, dealtFrameIndex)
    .some((f) => f?.state?.phase === 'setup' && hand(f, recorderId).length === 0 && f?.state?.players?.[recorderId]);

  const dealtCards = hand(frames[dealtFrameIndex], recorderId);
  const dealtHand = namedIds(dealtCards);
  if (dealtHand.length !== HAND_SIZE) return null;

  // Decision: hand identity dealt-vs-kept. A keep cannot change uuids; a
  // mulligan replaces the hand.
  let decision: 'keep' | 'mulligan';
  if (!sameHandIdentity(dealtCards, keptCards)) {
    decision = 'mulligan';
  } else if (sawPreDeal) {
    decision = 'keep';
  } else {
    // Capture started mid-setup and the hands match — "keep" is ambiguous
    // with "started after the redraw". Fall back to the recorder's decision
    // log line if this capture happened to carry it.
    let logged: 'keep' | 'mulligan' | null = null;
    if (username) {
      for (let i = 0; i <= setupEnd; i++) {
        for (const text of newMessageTexts(frames[i], frames[i - 1])) {
          if (!text.includes(username)) continue; // the opponent's decision line
          if (MULLIGAN_RE.test(text)) logged = 'mulligan';
          else if (KEEP_RE.test(text)) logged = 'keep';
        }
      }
    }
    if (logged !== 'keep') return null; // 'mulligan' → dealt hand unknown; none → ambiguous
    decision = 'keep';
  }

  // Initiative is assigned during setup, pre-mulligan. Scan the span for
  // whoever holds it; null when the recording never shows it.
  let wentFirst: boolean | null = null;
  for (let i = 0; i <= setupEnd && wentFirst === null; i++) {
    const players = frames[i]?.state?.players;
    if (!players || typeof players !== 'object') continue;
    for (const pid of Object.keys(players)) {
      if (players[pid]?.hasInitiative === true) { wentFirst = pid === recorderId; break; }
    }
  }

  return {
    recorderId,
    username,
    decision,
    dealtHand,
    keptHand,
    resourced,
    mulliganFrameIndex: dealtFrameIndex,
    resourceFrameIndex,
    wentFirst,
  };
}
