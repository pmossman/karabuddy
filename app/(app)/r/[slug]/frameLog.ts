// B110: pure read-side of the FrameAnimator. Everything here derives semantic
// facts from a karabast `gameState` (its `newMessages` log + `players` map) with
// NO DOM and NO animation — so it's unit-testable in isolation. The animator's
// effect calls these, hands the results to the (also pure) planner, then renders.

export interface FrameCard {
  zone: string;
  ctrl: string | undefined;
  // B134: upgrades live in an arena pile but carry a parentCardId pointing at
  // the unit they attach to (rendered as a subcard strip under that unit).
  parentCardId?: string;
  // B134: {set, number} for building a face-up card image when a hidden-hand
  // play has no full-card render to clone (an upgrade renders only as a strip).
  setId?: { set: string; number: number };
  // B148: the gamestate's combat flags. A reliable, log-INDEPENDENT signal for
  // who's attacking — karabast sometimes emits a combat frame with an empty log
  // (so the log-only extractAttacks misses the lunge), but the board still flags
  // the attacker. See boardAttacks.
  isAttacker?: boolean;
  isDefender?: boolean;
}
export interface AttackEvent { attackerUuid: string; targetUuid: string }
export interface InteractionEvent {
  sourceUuid: string;
  targetUuid: string;
  kind: 'damage' | 'heal';
  baseUuid: string | null; // caster's base — the bolt's origin when the source is off-board
}

// Per-card zone + controller (cardPiles) PLUS each player's leader (which lives
// on players[pid].leader, not in a pile). The leader's zone lets the planner
// tell a deploy/return (arena ↔ 'base' slot) from a plain arena reflow.
export function extractFrameCards(state: any): { cards: Map<string, FrameCard>; leaders: Set<string> } {
  const cards = new Map<string, FrameCard>();
  const leaders = new Set<string>();
  for (const pid of Object.keys(state?.players || {})) {
    const player = state.players[pid] || {};
    const piles = player.cardPiles || {};
    for (const z of Object.keys(piles)) {
      for (const c of piles[z] || []) {
        if (c?.uuid) cards.set(c.uuid, { zone: c.zone || z, ctrl: c.controllerId, parentCardId: c.parentCardId, setId: c.setId, isAttacker: c.isAttacker, isDefender: c.isDefender });
      }
    }
    const leader = player.leader;
    if (leader?.uuid) {
      leaders.add(leader.uuid);
      // B141: carry parentCardId/setId so the planner can spot a PILOT leader
      // deploying as an upgrade onto a vehicle (parentCardId set), not as a unit.
      cards.set(leader.uuid, { zone: leader.zone || 'base', ctrl: leader.controllerId, parentCardId: leader.parentCardId, setId: leader.setId, isAttacker: leader.isAttacker, isDefender: leader.isDefender });
    }
  }
  return { cards, leaders };
}

// Attacks from the log: "{player} attacks {targetCard} with {attackerCard}" or
// "{player} attacks {targetPlayer}'s base with {attackerCard}". Attacker = the
// card after "with" (last card part); target = the card right after "attacks",
// or — for a base attack — the attacker's opponent's base, resolved here.
export function extractAttacks(state: any): AttackEvent[] {
  const out: AttackEvent[] = [];
  const msgs = Array.isArray(state?.newMessages) ? state.newMessages : [];
  for (const m of msgs) {
    const parts = m?.message;
    if (!Array.isArray(parts)) continue;
    const ai = parts.findIndex((p: any) => typeof p === 'string' && /attacks/i.test(p));
    if (ai < 0) continue;
    const cards = parts.filter((p: any) => p && typeof p === 'object' && p.type === 'card' && p.uuid);
    if (cards.length === 0) continue;
    const attackerUuid = cards[cards.length - 1].uuid; // the "with X" card
    const afterAttacks = parts[ai + 1];
    const targetUuid =
      afterAttacks && typeof afterAttacks === 'object' && afterAttacks.type === 'card'
        ? afterAttacks.uuid
        : resolveBaseTarget(state, attackerUuid);
    if (targetUuid) out.push({ attackerUuid, targetUuid });
  }
  return out;
}

// B148: attacks detected from the BOARD, not the log — a unit with isAttacker
// set. The log-only extractAttacks misses a combat whose "X attacks Y" line the
// recorder dropped (an empty-log combat frame), so the lunge never fires. The
// target is the isDefender unit if it survived, else the single unit that just
// LEFT an arena (the defeated defender — its last rect is where the attacker
// thrusts). Skips when the target can't be pinned (no defender + 0 or >1 exits,
// e.g. a base attack — those keep a log and go through extractAttacks).
const isArenaZone = (z?: string) => z === 'groundArena' || z === 'spaceArena';
export function boardAttacks(
  cards: Map<string, FrameCard>,
  prevZones: Map<string, string>,
  // B172: uuids that were ALREADY isAttacker last frame. The flag marks "this
  // card is attacking NOW"; a single lunge is one attack, so we fire only on the
  // TRANSITION (flag newly set this frame). Without this, a flag karabast never
  // clears — e.g. two leaders that trade and BOTH defeat (r_wrbj85 f54+): the
  // defeated leaders keep isAttacker/isDefender in the `base` zone forever — makes
  // the lunge re-fire every subsequent frame. Defaults empty (no gating).
  prevAttackers: Set<string> = new Set(),
): AttackEvent[] {
  let hasAttacker = false;
  for (const [u, c] of cards) if (c.isAttacker && !prevAttackers.has(u)) { hasAttacker = true; break; }
  if (!hasAttacker) return [];

  const defender = [...cards].find(([, c]) => c.isDefender)?.[0];
  // A defeated defender LEAVES the arena (→ discard, still in `cards`) — so the
  // target is a unit whose zone WAS an arena last frame and is no longer one.
  const exited: string[] = [];
  for (const [u, z] of prevZones) {
    if (isArenaZone(z) && !isArenaZone(cards.get(u)?.zone)) exited.push(u);
  }

  const out: AttackEvent[] = [];
  for (const [uuid, c] of cards) {
    if (!c.isAttacker || prevAttackers.has(uuid)) continue; // newly-flagged attackers only
    const targetUuid = defender ?? (exited.length === 1 ? exited[0] : undefined);
    if (targetUuid && targetUuid !== uuid) out.push({ attackerUuid: uuid, targetUuid });
  }
  return out;
}

// B148: a base attack the recorder dropped ENTIRELY — no "attacks" log, no
// isAttacker flag (so extractAttacks + boardAttacks both miss it). The only
// surviving trace is the board itself: an enemy base's damage rose AND a single
// opposing unit newly EXHAUSTED, both in the SAME frame. That coincidence is the
// signature of a dropped attack: a normally-recorded attack splits its exhaust
// (the declaration frame) from its damage (the resolution frame) across two
// frames, so this never double-fires on a logged attack — only when the recorder
// collapsed the whole combat into one surviving frame (see r_jxqkup f72). The
// target is the damaged base (rendered, so the lunge has a rect); the attacker is
// the lone newly-exhausted enemy unit. Ambiguous cases (0 or >1 candidates, or an
// attacker already lunging via log/flag) are skipped.
function exhaustOf(state: any): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const pid of Object.keys(state?.players || {})) {
    const piles = state.players[pid]?.cardPiles || {};
    for (const z of ['groundArena', 'spaceArena']) {
      for (const c of piles[z] || []) if (c?.uuid) m.set(c.uuid, !!c.exhausted);
    }
  }
  return m;
}
function baseDamageOf(state: any): Map<string, { owner: string; damage: number }> {
  const m = new Map<string, { owner: string; damage: number }>();
  for (const pid of Object.keys(state?.players || {})) {
    const b = state.players[pid]?.base;
    if (b?.uuid) m.set(b.uuid, { owner: pid, damage: typeof b.damage === 'number' ? b.damage : 0 });
  }
  return m;
}
export function exhaustBaseAttacks(prevState: any, curState: any, alreadyAttackers: Set<string>): AttackEvent[] {
  if (!prevState || !curState) return [];
  const curBases = baseDamageOf(curState), prevBases = baseDamageOf(prevState);
  const damaged = [...curBases].filter(([u, b]) => b.damage > (prevBases.get(u)?.damage ?? 0));
  if (!damaged.length) return [];
  const prevEx = exhaustOf(prevState);
  const { cards } = extractFrameCards(curState);
  // uuid -> exhausted (units only; leaders attack too but exhaust the same way)
  const curEx = exhaustOf(curState);
  const out: AttackEvent[] = [];
  for (const [baseUuid, base] of damaged) {
    const candidates: string[] = [];
    for (const [u, exhausted] of curEx) {
      if (!exhausted || prevEx.get(u) !== false) continue;   // newly exhausted this frame
      if (alreadyAttackers.has(u)) continue;                  // already lunging via log/flag
      if (cards.get(u)?.ctrl === base.owner) continue;        // must be the base owner's OPPONENT
      candidates.push(u);
    }
    if (candidates.length === 1) out.push({ attackerUuid: candidates[0], targetUuid: baseUuid });
  }
  return out;
}

// B161: units defeated this frame, from the BOARD diff — a unit that was in an
// arena last frame and is now in DISCARD. Log-independent, so it catches the
// ~29% of defeats the recorder logged no line for (an event / indirect-damage
// kill that the timeline's log + attack signals miss entirely). Excludes leaders
// (they don't die to discard) and upgrades (they follow their host to discard,
// not a unit death of their own). The CALLER excludes units an attack on this
// frame already kills — those deaths are part of the attacker's lunge.
export function boardDefeats(prevState: any, curState: any): string[] {
  if (!prevState || !curState) return [];
  const prev = extractFrameCards(prevState).cards;
  const cur = extractFrameCards(curState);
  const out: string[] = [];
  for (const [u, info] of cur.cards) {
    if (info.zone !== 'discard') continue;          // landed in discard…
    if (cur.leaders.has(u) || info.parentCardId) continue; // …not a leader/upgrade
    if (isArenaZone(prev.get(u)?.zone)) out.push(u); // …and was on the board last frame
  }
  return out;
}

// B147 / ADR 0008 step 2d: THE single attack classifier — the one place that
// resolves a frame's full attack set, layering the three detection signals
// (weakest-last) and deduping so each attacker lunges once:
//   1. the LOG ("X attacks Y with Z") — extractAttacks
//   2. the isAttacker board flag (recorder dropped the log) — boardAttacks
//   3. the exhaust+damage coincidence (recorder dropped the flag too) — exhaustBaseAttacks
// Both the renderer (via the planner's `attacks` input) and the dwell (via
// buildTimeline) consume THIS, so they can never classify attacks differently
// (the B146 drift class). Pure: prev+cur frame states in, AttackEvent[] out.
function zonesOf(state: any): Map<string, string> {
  const m = new Map<string, string>();
  for (const [u, c] of extractFrameCards(state).cards) m.set(u, c.zone);
  return m;
}
export function frameAttacks(prevState: any, curState: any): AttackEvent[] {
  const { cards } = extractFrameCards(curState);
  const log = extractAttacks(curState);
  const logSet = new Set(log.map((a) => a.attackerUuid));
  // B172: the prior frame's isAttacker set — boardAttacks fires only on a fresh
  // flag, so a never-cleared flag (defeated-leader trade) lunges once, not forever.
  const prevAttackers = new Set<string>();
  if (prevState) for (const [u, c] of extractFrameCards(prevState).cards) if (c.isAttacker) prevAttackers.add(u);
  const board = boardAttacks(cards, prevState ? zonesOf(prevState) : new Map(), prevAttackers).filter((b) => !logSet.has(b.attackerUuid));
  // Already lunging via the log or the isAttacker flag → exclude from the
  // weakest (exhaust) signal so a dropped-flag fallback can't double-fire.
  const already = new Set(logSet);
  for (const [u, c] of cards) if (c.isAttacker) already.add(u);
  for (const b of board) already.add(b.attackerUuid);
  const base = exhaustBaseAttacks(prevState, curState, already);
  return [...log, ...board, ...base];
}

// Non-combat interactions: "{player} uses/plays [source] to deal N damage to /
// defeat / heal [target]". Source = first card part, target = last. Drops combat
// ("attacks" / "is defeated by"), shield redirects ("instead of"), and
// self-targets. Pre-resolves the caster's base (bolt origin for event sources).
export function extractInteractions(state: any): InteractionEvent[] {
  const out: InteractionEvent[] = [];
  const msgs = Array.isArray(state?.newMessages) ? state.newMessages : [];
  for (const m of msgs) {
    const parts = m?.message;
    if (!Array.isArray(parts)) continue;
    const text = parts.filter((p: any) => typeof p === 'string').join(' ');
    if (/attacks/i.test(text) || /instead of/i.test(text)) continue;
    let kind: 'damage' | 'heal' | null = null;
    if (/\bdeal\b[^.]*\bdamage\b|\bto (?:defeat|destroy)\b/i.test(text)) kind = 'damage';
    else if (/\bheal\b/i.test(text)) kind = 'heal';
    else continue;
    const cards = parts.filter((p: any) => p && typeof p === 'object' && p.type === 'card' && p.uuid);
    if (cards.length < 2) continue;
    const sourceUuid = cards[0].uuid;
    const targetUuid = cards[cards.length - 1].uuid;
    if (sourceUuid === targetUuid) continue;
    const caster = parts.find((p: any) => p && typeof p === 'object' && p.type === 'player');
    out.push({ sourceUuid, targetUuid, kind, baseUuid: playerBaseByName(state, caster?.name ?? null) });
  }
  return out;
}

// A base attack's target = the base of the attacker's opponent.
export function resolveBaseTarget(state: any, attackerUuid: string): string | null {
  const players = state?.players || {};
  let controllerId: string | null = null;
  for (const k of Object.keys(players)) {
    const piles = players[k]?.cardPiles || {};
    for (const z of Object.keys(piles)) {
      for (const c of piles[z] || []) {
        if (c?.uuid === attackerUuid) controllerId = c.controllerId;
      }
    }
  }
  if (!controllerId) return null;
  const oppKey = Object.keys(players).find((k) => k !== controllerId);
  return oppKey ? players[oppKey]?.base?.uuid ?? null : null;
}

// The caster's OWN base uuid, matched by username (player parts carry the name).
export function playerBaseByName(state: any, name: string | null): string | null {
  if (!name) return null;
  const players = state?.players || {};
  for (const k of Object.keys(players)) {
    if (players[k]?.user?.username === name) return players[k]?.base?.uuid ?? null;
  }
  return null;
}

// B134: event plays from the log — "{player} plays {card} ..." where the card
// resolves to DISCARD this frame (the planner applies that zone check; unit
// plays into an arena are the existing playFlip pairing). The card part
// immediately after the "plays" string is the played card.
export interface EventPlayMsg { uuid: string }
export function extractEventPlays(state: any): EventPlayMsg[] {
  const out: EventPlayMsg[] = [];
  const msgs = Array.isArray(state?.newMessages) ? state.newMessages : [];
  for (const m of msgs) {
    const parts = m?.message;
    if (!Array.isArray(parts)) continue;
    const pi = parts.findIndex((p: any) => typeof p === 'string' && /\bplays\b/i.test(p));
    if (pi < 0) continue;
    const after = parts[pi + 1];
    if (after && typeof after === 'object' && after.type === 'card' && after.uuid) {
      out.push({ uuid: after.uuid });
    }
  }
  return out;
}

// B134: base uuid → owning player id, for the event-stage point (the played
// card pauses between the bases, biased toward the caster's opponent).
export function extractBases(state: any): Map<string, string> {
  const m = new Map<string, string>();
  for (const pid of Object.keys(state?.players || {})) {
    const uuid = state.players[pid]?.base?.uuid;
    if (uuid) m.set(uuid, pid);
  }
  return m;
}

// ADR 0008 step 2d: THE single rule classifying a played card by where it
// landed — shared by the timeline (classifyStagedPlays / unitPlayUuids) and the
// planner's staged-play branch, so "what kind of play is this" is judged ONE way.
//   • discard          → an EVENT (flies out, presents, drops to discard)
//   • arena + parent    → an UPGRADE (tucks under its host unit)
//   • arena (no parent) → a UNIT play
export type PlayKind = 'event' | 'upgrade' | 'unit';
export function playKindOf(info: FrameCard | undefined): PlayKind | null {
  if (!info) return null;
  if (info.zone === 'discard') return 'event';
  if (info.zone !== 'groundArena' && info.zone !== 'spaceArena') return null;
  return info.parentCardId ? 'upgrade' : 'unit';
}

// B134: classify the staged plays in a frame (events that land in DISCARD,
// upgrades that attach to a unit) so playback can dwell long enough for the
// full fly-out → present → land choreography. Uses the shared playKindOf so it
// can't diverge from the planner's branch in frameAnimationPlan.
export function classifyStagedPlays(state: any): { events: number; upgrades: number } {
  const { cards } = extractFrameCards(state);
  let events = 0, upgrades = 0;
  for (const { uuid } of extractEventPlays(state)) {
    const k = playKindOf(cards.get(uuid));
    if (k === 'event') events++;
    else if (k === 'upgrade') upgrades++;
  }
  return { events, upgrades };
}

// B134: uuids of UNITS played into an arena this frame (a unit play, not an
// event → discard or an upgrade → unit). Lets playback detect an "ambush"
// (a unit played then attacking in the same action) so the play animation
// finishes before the attack lunge.
export function unitPlayUuids(state: any): string[] {
  const { cards } = extractFrameCards(state);
  const out: string[] = [];
  for (const { uuid } of extractEventPlays(state)) {
    if (playKindOf(cards.get(uuid)) === 'unit') out.push(uuid);
  }
  return out;
}

// B134: how many cards each player resourced this frame, keyed by controller
// id. The opponent's resourced cards become anonymous (uuid-less) pile cards,
// so the count is the only signal of how many hidden cards to fly to the pile.
// Parses "{player} has resourced N card(s) from hand".
export function extractResourceCounts(state: any): Map<string, number> {
  const out = new Map<string, number>();
  const nameToCtrl = new Map<string, string>();
  for (const pid of Object.keys(state?.players || {})) {
    const u = state.players[pid]?.user?.username;
    if (typeof u === 'string' && u) nameToCtrl.set(u, pid);
  }
  const msgs = Array.isArray(state?.newMessages) ? state.newMessages : [];
  for (const m of msgs) {
    const parts = m?.message;
    if (!Array.isArray(parts)) continue;
    const text = parts.filter((p: any) => typeof p === 'string').join(' ');
    const mt = /resourced\s+(\d+)\s+card/i.exec(text);
    if (!mt) continue;
    const count = parseInt(mt[1], 10);
    const playerPart = parts.find((p: any) => p && typeof p === 'object' && p.type === 'player');
    const ctrl = playerPart ? nameToCtrl.get(playerPart.name) : undefined;
    if (ctrl && count > 0) out.set(ctrl, (out.get(ctrl) || 0) + count);
  }
  return out;
}
