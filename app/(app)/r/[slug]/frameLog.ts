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
        if (c?.uuid) cards.set(c.uuid, { zone: c.zone || z, ctrl: c.controllerId, parentCardId: c.parentCardId, setId: c.setId });
      }
    }
    const leader = player.leader;
    if (leader?.uuid) {
      leaders.add(leader.uuid);
      // B141: carry parentCardId/setId so the planner can spot a PILOT leader
      // deploying as an upgrade onto a vehicle (parentCardId set), not as a unit.
      cards.set(leader.uuid, { zone: leader.zone || 'base', ctrl: leader.controllerId, parentCardId: leader.parentCardId, setId: leader.setId });
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

// B134: classify the staged plays in a frame (events that land in DISCARD,
// upgrades that attach to a unit) so playback can dwell long enough for the
// full fly-out → present → land choreography. MUST agree with the planner's
// branch in frameAnimationPlan (zone==='discard' vs parentCardId+arena).
export function classifyStagedPlays(state: any): { events: number; upgrades: number } {
  const { cards } = extractFrameCards(state);
  let events = 0, upgrades = 0;
  for (const { uuid } of extractEventPlays(state)) {
    const info = cards.get(uuid);
    if (!info) continue;
    if (info.zone === 'discard') events++;
    else if (info.parentCardId && (info.zone === 'groundArena' || info.zone === 'spaceArena')) upgrades++;
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
    const info = cards.get(uuid);
    if (info && !info.parentCardId && (info.zone === 'groundArena' || info.zone === 'spaceArena')) out.push(uuid);
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
