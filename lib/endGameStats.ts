// B104: end-of-game summary stats. Pure derivation from the decoded frames —
// no DB, no card catalog, no network. Every stat here is computed from
// BOARD-VISIBLE state (base damage counters, arena/discard membership, the
// per-player `availableResources` count, `phase`), so it's reliable for BOTH
// players even though recordings are single-perspective (the masking invariant
// in statsExtract.ts only hides hand/deck contents, which none of these touch).
//
// Powers the end-of-replay summary card: who won + how, plus a few satisfying
// per-player totals (damage dealt to the opposing base, base damage healed,
// cards played, enemy units defeated, resources floated).

const isArena = (z: string) => z === 'groundArena' || z === 'spaceArena';

// Every SWU base has 30 HP. We read `base.hp` from the state when present, but
// fall back to this so base-destruction detection (and therefore the
// destroyed-vs-conceded distinction) stays correct even if a recorded payload
// omits the field — otherwise a missing hp would mislabel every win a concede.
const DEFAULT_BASE_HP = 30;

export interface PlayerEndStats {
  playerId: string;
  username: string | null;
  won: boolean | null;
  baseDamageDealt: number; // gross damage this player dealt to the opposing base
  baseDamageHealed: number; // gross damage healed off this player's own base
  cardsPlayed: number; // distinct cards this player put into an arena
  unitsDefeated: number; // enemy units sent from an arena to the discard (kills)
  resourcesFloated: number; // unspent ready resources summed over completed rounds
  finalBaseDamage: number;
  baseHp: number | null;
  baseDestroyed: boolean;
}

export interface EndGameStats {
  players: PlayerEndStats[];
  winners: string[] | null;
  // 'base' = a loser's base was destroyed; 'concede' = there's a winner but no
  // base fell (concession / timeout); 'unknown' = no winner signal (disconnect /
  // abandon / pre-B59 replay).
  endReason: 'base' | 'concede' | 'unknown';
  rounds: number; // completed action phases
}

export function computeEndGameStats(
  frames: ReadonlyArray<{ state: any }> | null,
  winners: string[] | null,
): EndGameStats | null {
  if (!frames || frames.length === 0) return null;
  const finalPlayers = frames[frames.length - 1]?.state?.players;
  if (!finalPlayers || typeof finalPlayers !== 'object') return null;
  const ids = Object.keys(finalPlayers);
  if (ids.length === 0) return null;
  const opponentOf = (pid: string) => ids.find((x) => x !== pid) ?? pid;

  const prevBaseDmg: Record<string, number> = {};
  const grossReceived: Record<string, number> = {}; // gross damage onto this base
  const healed: Record<string, number> = {};
  const cardsPlayed: Record<string, number> = {};
  const deaths: Record<string, number> = {}; // this player's units that died
  const floated: Record<string, number> = {};
  const lastActionAvail: Record<string, number> = {};
  for (const id of ids) {
    prevBaseDmg[id] = 0; grossReceived[id] = 0; healed[id] = 0;
    cardsPlayed[id] = 0; deaths[id] = 0; floated[id] = 0; lastActionAvail[id] = 0;
  }

  const lastZone = new Map<string, string>(); // `${pid} ${uuid}` -> last seen zone
  const playedSeen = new Set<string>();
  const deathSeen = new Set<string>();

  let prevPhase: string | null = null;
  let rounds = 0;
  let firstFrame = true;

  for (const f of frames) {
    const st = f?.state;
    const players = st?.players;
    if (!players || typeof players !== 'object') continue;
    const phase: string | null = typeof st.phase === 'string' ? st.phase : null;

    for (const pid of ids) {
      const p = players[pid];
      if (!p) continue;

      // Base damage: positive deltas = damage taken, negative = healing.
      const dmg = Number(p.base?.damage ?? 0) || 0;
      if (!firstFrame) {
        const d = dmg - prevBaseDmg[pid];
        if (d > 0) grossReceived[pid] += d;
        else if (d < 0) healed[pid] += -d;
      }
      prevBaseDmg[pid] = dmg;

      // Zone transitions → plays (into an arena) + deaths (arena → discard).
      const piles = p.cardPiles;
      if (piles && typeof piles === 'object') {
        for (const zone of Object.keys(piles)) {
          const list = piles[zone];
          if (!Array.isArray(list)) continue;
          for (const card of list) {
            const uuid = card?.uuid;
            if (!uuid) continue;
            const key = `${pid} ${uuid}`;
            const prev = lastZone.get(key);
            if (prev === zone) continue;
            lastZone.set(key, zone);
            if (isArena(zone)) {
              if (!playedSeen.has(key)) { playedSeen.add(key); cardsPlayed[pid] += 1; }
            } else if (zone === 'discard' && prev && isArena(prev)) {
              if (!deathSeen.has(key)) { deathSeen.add(key); deaths[pid] += 1; }
            }
          }
        }
      }

      // Track unspent resources at the latest action frame (float candidate).
      if (phase === 'action') lastActionAvail[pid] = Number(p.availableResources ?? 0) || 0;
    }

    // A round completes when the action phase ends (action → regroup). The
    // float that round = each player's unspent resources at its last action
    // frame. The DECIDED (final) action phase never transitions out, so its
    // float is naturally excluded — floating as the game ends is noise.
    if (prevPhase === 'action' && phase && phase !== 'action') {
      rounds += 1;
      for (const pid of ids) floated[pid] += lastActionAvail[pid];
    }
    prevPhase = phase;
    firstFrame = false;
  }

  const players: PlayerEndStats[] = ids.map((pid) => {
    const p = finalPlayers[pid] || {};
    const finalDmg = Number(p.base?.damage ?? 0) || 0;
    const hpRaw = Number(p.base?.hp);
    const baseHp = Number.isFinite(hpRaw) && hpRaw > 0 ? hpRaw : DEFAULT_BASE_HP;
    return {
      playerId: pid,
      username: p.user?.username ?? null,
      won: winners ? winners.includes(pid) : null,
      baseDamageDealt: grossReceived[opponentOf(pid)] ?? 0,
      baseDamageHealed: healed[pid] ?? 0,
      cardsPlayed: cardsPlayed[pid] ?? 0,
      unitsDefeated: deaths[opponentOf(pid)] ?? 0,
      resourcesFloated: floated[pid] ?? 0,
      finalBaseDamage: finalDmg,
      baseHp,
      baseDestroyed: baseHp != null ? finalDmg >= baseHp : false,
    };
  });

  let endReason: EndGameStats['endReason'] = 'unknown';
  if (winners && winners.length > 0) {
    const losersBaseFell = players.some((p) => !winners.includes(p.playerId) && p.baseDestroyed);
    endReason = losersBaseFell ? 'base' : 'concede';
  }

  return { players, winners: winners ?? null, endReason, rounds };
}
