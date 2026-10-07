// B101/P0 (ADR 0007): pure fact extraction from a decoded replay → the two
// materialized outputs that feed all Stats/Meta aggregation:
//
//   • ONE MatchFact  — Tier A: leaders/bases/aspects/winner/format. Powers the
//                      leader-vs-leader matrix + archetype win rates with plain
//                      SQL, no frame mining.
//   • N  CardEvents   — Tier B: drawn / resourced / played / discarded, derived
//                      by diffing each card's zone across frames by `uuid`.
//
// THE MASKING INVARIANT (the reason this is careful): recordings are single-
// perspective. The decoder replaces opponent hand cards with HIDDEN sentinels,
// and the opponent's deck/resources are face-down (no `setId`). So if we only
// ever consider cards with a real `setId`, then:
//   - drawn / resourced events exist ONLY for the recorder (their hand/deck are
//     the only real ones) → attribution 'recorder'.
//   - played / discarded happen in board-visible zones → observed for BOTH
//     players → attribution 'both'.
// Every CardEvent carries that `attribution` so the UI can label whole-meta vs
// recorder-side stats honestly. No turn/curve data yet — the gamestate exposes
// `phase` but no clean round counter (see ADR 0007), so we record `frameIndex`
// and leave turn derivation to a later phase.

import type { DecodedReplay, MatchMeta } from './replayDecoder';
import { HIDDEN_SET, baseUpgradesOf, leadersOf } from './replayDecoder';

export type CardEventType = 'drawn' | 'resourced' | 'played' | 'discarded';
export type Attribution = 'both' | 'recorder';

export interface MatchFactPlayer {
  playerId: string;
  username: string | null;
  leader: string | null; // cardId SET_NNN
  base: string | null;
  aspects: string[]; // union of leader + base aspects
  isRecorder: boolean;
  won: boolean | null; // null when there's no winner signal
}

export interface MatchFact {
  gameId: string;
  format: string | null;
  cardPool: string | null;
  bo3: boolean | null;
  durationMs: number | null;
  players: MatchFactPlayer[];
  // 'decisive' = exactly one winner; 'draw' = explicit empty-winner signal;
  // 'unknown' = no winner signal (abandon / disconnect / pre-B59).
  result: 'decisive' | 'draw' | 'unknown';
}

export interface CardEvent {
  gameId: string;
  playerId: string;
  isRecorder: boolean;
  cardId: string; // SET_NNN
  event: CardEventType;
  attribution: Attribution;
  frameIndex: number;
  sideWon: boolean | null;
}

// A card observed in a visible zone — feeds the self-healing catalog upsert
// (ADR 0007): any cardId not yet in `cards` is registered straight from here,
// so spoiler-season cards appear the first time anyone plays one.
// B235: fold per-event rows into the per-side map stored on
// match_players.card_events — event → cardId → FIRST frame index. Copies of a
// card collapse (min frame); attribution is implied by the event kind.
export type CardEventMap = Partial<Record<CardEventType, Record<string, number>>>;

export function aggregateCardEvents(events: CardEvent[]): Map<string, CardEventMap> {
  const bySide = new Map<string, CardEventMap>();
  for (const e of events) {
    let m = bySide.get(e.playerId);
    if (!m) { m = {}; bySide.set(e.playerId, m); }
    const byCard = (m[e.event] ??= {});
    const prev = byCard[e.cardId];
    if (prev === undefined || e.frameIndex < prev) byCard[e.cardId] = e.frameIndex;
  }
  return bySide;
}

export interface ObservedCard {
  cardId: string;
  name: string | null;
  aspects: string[];
  cost: number | null;
  type: string | null;
}

export interface ExtractOptions {
  gameId: string;
  winners: string[] | null; // playerIds (from extractWinners)
  ownerPlayerId: string | null; // recorder's playerId (POV)
  durationMs: number | null;
  match?: MatchMeta | null; // overrides decoded.meta.match if given
}

const ZONES = ['hand', 'deck', 'resources', 'groundArena', 'spaceArena', 'discard', 'capturedZone'] as const;
// 'base' is not a pile: it stands for the Fortify upgrades on the player's base
// (baseUpgradesOf), which are in play like a unit's upgrades.
type Zone = (typeof ZONES)[number] | 'base';
const IN_PLAY: Zone[] = ['groundArena', 'spaceArena', 'base'];

// B230: "played" is derived from the game LOG ("<player> plays <card>"), the
// ground truth for a card being played, instead of arena-entry. Zone-entry
// can't see EVENT cards (they resolve hand→discard, never touching an arena) so
// events had a 0 play-rate everywhere; nor can it see the opponent's masked
// hand-origin plays. The log carries both. Matches the card object right after.
const PLAYS_RE = /\bplays\b/i;

// SET_NNN, zero-padded. null for hidden sentinels / cards with no real setId
// (masked opponent hand, face-down deck/resources).
export function cardIdOf(card: any): string | null {
  const sid = card?.setId;
  if (!sid || typeof sid.set !== 'string' || sid.set === HIDDEN_SET || sid.number == null) return null;
  return `${sid.set}_${String(sid.number).padStart(3, '0')}`;
}

const aspectsOf = (card: any): string[] => (Array.isArray(card?.aspects) ? card.aspects.filter((a: any) => typeof a === 'string') : []);

// The recorder is the single player whose HAND holds real (non-masked) cards —
// the opponent's hand is HIDDEN sentinels by construction. We infer it from the
// frames when the caller didn't supply ownerPlayerId (older replays never
// stored it), so `isRecorder` stays reliable regardless of that column. Returns
// null only if no real hand card is ever visible (e.g. a very short replay).
function inferRecorder(frames: { state: any }[]): string | null {
  for (const frame of frames) {
    const players = frame.state?.players;
    if (!players || typeof players !== 'object') continue;
    for (const pid of Object.keys(players)) {
      const hand = players[pid]?.cardPiles?.hand;
      if (Array.isArray(hand) && hand.some((c) => cardIdOf(c))) return pid;
    }
  }
  return null;
}

function buildMatchFact(decoded: DecodedReplay, opts: ExtractOptions): MatchFact | null {
  const frames = decoded.frames || [];
  const finalState = frames.length ? frames[frames.length - 1].state : null;
  const players = finalState?.players;
  if (!players || typeof players !== 'object') return null;

  const winners = opts.winners;
  const match = opts.match ?? decoded.meta?.match ?? null;
  const factPlayers: MatchFactPlayer[] = Object.keys(players).map((pid) => {
    const p = players[pid] || {};
    const leaders = leadersOf(p);
    return {
      playerId: pid,
      username: p.user?.username ?? null,
      leader: cardIdOf(leaders[0]),
      base: cardIdOf(p.base),
      aspects: Array.from(new Set([...leaders.flatMap(aspectsOf), ...aspectsOf(p.base)])),
      isRecorder: opts.ownerPlayerId != null && pid === opts.ownerPlayerId,
      won: winners ? winners.includes(pid) : null,
    };
  });

  const result: MatchFact['result'] = winners == null ? 'unknown' : winners.length === 0 ? 'draw' : 'decisive';

  return {
    gameId: opts.gameId,
    format: match?.gameFormat ?? null,
    cardPool: match?.cardPool ?? null,
    bo3: match?.gamesToWinMode == null ? null : match.gamesToWinMode === 'bestOfThree',
    durationMs: opts.durationMs ?? decoded.meta?.durationMs ?? null,
    players: factPlayers,
    result,
  };
}

function buildCardEvents(
  decoded: DecodedReplay,
  opts: ExtractOptions,
): { cardEvents: CardEvent[]; observedCards: ObservedCard[] } {
  const frames = decoded.frames || [];
  const winners = opts.winners;
  const sideWon = (pid: string): boolean | null => (winners ? winners.includes(pid) : null);

  // Per (playerId, uuid): the last zone we saw it in, so we only react to
  // transitions. Per (playerId, uuid, event): emit-once dedupe.
  const lastZone = new Map<string, Zone>();
  const emitted = new Set<string>();
  const observed = new Map<string, ObservedCard>();
  const cardEvents: CardEvent[] = [];
  const playedUuids = new Set<string>(); // uuids the game log says were PLAYED

  const emit = (playerId: string, uuid: string, cardId: string, event: CardEventType, attribution: Attribution, frameIndex: number) => {
    const key = `${playerId} ${uuid} ${event}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    cardEvents.push({ gameId: opts.gameId, playerId, isRecorder: playerId === opts.ownerPlayerId, cardId, event, attribution, frameIndex, sideWon: sideWon(playerId) });
  };

  // PASS 1: 'played' from the game log. newMessages is CUMULATIVE (the whole log
  // so far) and NOT strictly monotonic across frames (undos/rollbacks rewrite the
  // tail), so we FULL-SCAN each frame's log and lean on emit-once for dedupe:
  // the first frame a "plays <card>" appears is its play frame, and re-sightings
  // in later frames are dropped. O(frames * log) but tiny. The card object right
  // after "plays" carries setId (cardId), controllerId (the player who played it,
  // a real gamestate id) and uuid.
  frames.forEach((frame, frameIndex) => {
    const msgs = frame.state?.newMessages;
    if (!Array.isArray(msgs)) return;
    for (const entry of msgs) {
      const parts = Array.isArray(entry) ? entry : entry?.message;
      if (!Array.isArray(parts)) continue;
      for (let i = 0; i < parts.length; i++) {
        if (typeof parts[i] !== 'string' || !PLAYS_RE.test(parts[i])) continue;
        const card = parts[i + 1];
        if (!card || typeof card !== 'object') continue;
        const cardId = cardIdOf(card);
        const playerId = typeof card.controllerId === 'string' ? card.controllerId : null;
        const uuid = typeof card.uuid === 'string' ? card.uuid : null;
        if (!cardId || !playerId || !uuid) continue;
        playedUuids.add(uuid);
        emit(playerId, uuid, cardId, 'played', 'both', frameIndex);
      }
    }
  });

  // PASS 2: 'drawn' / 'resourced' / 'discarded' from zone transitions.
  frames.forEach((frame, frameIndex) => {
    const players = frame.state?.players;
    if (!players || typeof players !== 'object') return;
    for (const playerId of Object.keys(players)) {
      const piles = players[playerId]?.cardPiles;
      if (!piles || typeof piles !== 'object') continue;
      const lists: [Zone, unknown][] = ZONES.map((z) => [z, piles[z]]);
      lists.push(['base', baseUpgradesOf(players[playerId])]);
      for (const [zone, list] of lists) {
        if (!Array.isArray(list)) continue;
        for (const card of list) {
          const cardId = cardIdOf(card);
          if (!cardId) continue; // hidden / face-down → skip (masking invariant)
          const uuid: string = card.uuid || `${playerId}:${zone}:${cardId}`;
          if (!observed.has(cardId)) {
            observed.set(cardId, {
              cardId,
              name: typeof card.name === 'string' && card.name ? card.name : null,
              aspects: aspectsOf(card),
              cost: typeof card.cost === 'number' ? card.cost : null,
              type: typeof card.type === 'string' ? card.type : (typeof card.printedType === 'string' ? card.printedType : null),
            });
          }
          const prev = lastZone.get(`${playerId} ${uuid}`);
          if (prev === zone) continue;
          lastZone.set(`${playerId} ${uuid}`, zone);
          // Classify the transition into the current zone.
          if (zone === 'hand' && (prev === undefined || prev === 'deck')) {
            // Opening hand (prev undefined) or a draw-step draw. Recorder-only
            // by the masking invariant (opp hand is HIDDEN → never reaches here).
            emit(playerId, uuid, cardId, 'drawn', 'recorder', frameIndex);
          } else if (zone === 'resources' && prev === 'hand') {
            emit(playerId, uuid, cardId, 'resourced', 'recorder', frameIndex);
          } else if (zone === 'discard') {
            // A PLAYED card reaching discard from outside play is an event
            // resolving (the play IS its trip to discard), not a discard. Unit
            // deaths (arena to discard), defeated Fortify upgrades (base to
            // discard), mills (deck to discard), and hand-discards of UNPLAYED
            // cards stay 'discarded'. Arena entry no longer emits 'played' at
            // all: the game log (pass 1) owns that.
            const resolvedPlay = playedUuids.has(uuid) && !IN_PLAY.includes(prev as Zone);
            if (!resolvedPlay) emit(playerId, uuid, cardId, 'discarded', 'both', frameIndex);
          }
        }
      }
    }
  });

  return { cardEvents, observedCards: Array.from(observed.values()) };
}

export function extractReplayFacts(
  decoded: DecodedReplay,
  opts: ExtractOptions,
): { matchFact: MatchFact | null; cardEvents: CardEvent[]; observedCards: ObservedCard[] } {
  // Fall back to inferring the recorder from the frames when ownerPlayerId
  // wasn't supplied (keeps isRecorder accurate on historical replays).
  const recorderId = opts.ownerPlayerId ?? inferRecorder(decoded.frames || []);
  const effective: ExtractOptions = { ...opts, ownerPlayerId: recorderId };
  const matchFact = buildMatchFact(decoded, effective);
  const { cardEvents, observedCards } = buildCardEvents(decoded, effective);
  return { matchFact, cardEvents, observedCards };
}
