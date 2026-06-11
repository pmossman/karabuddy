// B124: pure Swiss-tournament engine — standings + pairings. No DB imports;
// inputs are plain objects so the exhaustive unit tests need no infra. The
// API routes adapt DB rows into these shapes.
//
// Scoring (ours, MTG-inspired, documented here as the source of truth):
//   - match points: win 3 / draw 1 / loss 0
//   - a BYE (entrant2Id === null) is a 2-0 win: 3 points, counts toward the
//     entrant's own MW%/GW% denominators, but contributes NOTHING to OMW%/OGW%
//     (there is no opponent)
//   - MW% and GW% are floored at 1/3 (MTG-style) so early losses don't
//     vaporize an opponent's tiebreak contribution
//   - OMW%/OGW% = mean of (floored) opponents' percentages, byes excluded
//   - standings sort: points → OMW% → GW% → OGW% → deterministic hash of
//     (seed, entrantId) so ties never depend on insertion order
//
// Matches with NO games recorded (status pending) earn no points and don't
// enter percentage denominators — but they DO count as "already paired" for
// rematch avoidance.

import { createHash } from 'node:crypto';

export interface SwissEntrant {
  id: string;
  dropped?: boolean;
}

export interface SwissMatch {
  entrant1Id: string;
  entrant2Id: string | null; // null = bye for entrant1
  games: { winner: string | null }[]; // winner = entrantId; null = draw/unfinished
}

export interface Standing {
  entrantId: string;
  rank: number; // 1-based, after sort
  points: number;
  wins: number;
  losses: number;
  draws: number;
  matchesPlayed: number; // completed matches incl. byes
  gameWins: number;
  gamesPlayed: number;
  mwp: number; // floored at 1/3 once matchesPlayed > 0
  gwp: number;
  omwp: number;
  ogwp: number;
  hadBye: boolean;
  dropped: boolean;
}

const FLOOR = 1 / 3;

// A match is "completed" once it has at least one recorded game (reported /
// confirmed); byes are stored pre-filled so they're always completed.
const isCompleted = (m: SwissMatch) => m.entrant2Id === null || m.games.length > 0;

interface Tally {
  points: number;
  wins: number;
  losses: number;
  draws: number;
  matchesPlayed: number;
  gameWins: number;
  gamesPlayed: number;
  opponents: string[]; // real opponents from completed matches (byes excluded)
  hadBye: boolean;
}

function tally(entrantIds: Set<string>, matches: SwissMatch[]): Map<string, Tally> {
  const t = new Map<string, Tally>();
  const get = (id: string): Tally => {
    let v = t.get(id);
    if (!v) {
      v = { points: 0, wins: 0, losses: 0, draws: 0, matchesPlayed: 0, gameWins: 0, gamesPlayed: 0, opponents: [], hadBye: false };
      t.set(id, v);
    }
    return v;
  };
  for (const id of entrantIds) get(id);

  for (const m of matches) {
    if (!isCompleted(m)) continue;
    if (m.entrant2Id === null) {
      // Bye: 2-0 win, no opponent.
      const e = get(m.entrant1Id);
      e.points += 3;
      e.wins += 1;
      e.matchesPlayed += 1;
      e.gameWins += 2;
      e.gamesPlayed += 2;
      e.hadBye = true;
      continue;
    }
    const a = get(m.entrant1Id);
    const b = get(m.entrant2Id);
    let aGames = 0, bGames = 0;
    for (const g of m.games) {
      if (g.winner === m.entrant1Id) aGames++;
      else if (g.winner === m.entrant2Id) bGames++;
      // winner null = drawn/unfinished game: counts as played, no win.
    }
    a.gameWins += aGames;
    b.gameWins += bGames;
    a.gamesPlayed += m.games.length;
    b.gamesPlayed += m.games.length;
    a.matchesPlayed += 1;
    b.matchesPlayed += 1;
    a.opponents.push(m.entrant2Id);
    b.opponents.push(m.entrant1Id);
    if (aGames > bGames) { a.points += 3; a.wins += 1; b.losses += 1; }
    else if (bGames > aGames) { b.points += 3; b.wins += 1; a.losses += 1; }
    else { a.points += 1; b.points += 1; a.draws += 1; b.draws += 1; }
  }
  return t;
}

const flooredMwp = (t: Tally) => (t.matchesPlayed === 0 ? 0 : Math.max(FLOOR, t.points / (3 * t.matchesPlayed)));
const flooredGwp = (t: Tally) => (t.gamesPlayed === 0 ? 0 : Math.max(FLOOR, t.gameWins / t.gamesPlayed));

// Deterministic last-resort tiebreak: unbiased w.r.t. registration order,
// reproducible across reads for the same tournament seed.
function hashTiebreak(seed: string, entrantId: string): string {
  return createHash('sha1').update(`${seed}:${entrantId}`).digest('hex');
}

export function computeStandings(
  entrants: SwissEntrant[],
  matches: SwissMatch[],
  seed = ''
): Standing[] {
  const ids = new Set(entrants.map((e) => e.id));
  const tallies = tally(ids, matches);
  const droppedById = new Map(entrants.map((e) => [e.id, !!e.dropped]));

  const rows = entrants.map((e) => {
    const t = tallies.get(e.id)!;
    // Opponent percentages: mean of each opponent's floored MW%/GW%.
    let omwp = 0, ogwp = 0;
    if (t.opponents.length > 0) {
      let mwSum = 0, gwSum = 0;
      for (const opp of t.opponents) {
        const ot = tallies.get(opp);
        if (!ot) continue; // opponent no longer in entrant list (shouldn't happen)
        mwSum += flooredMwp(ot);
        gwSum += flooredGwp(ot);
      }
      omwp = mwSum / t.opponents.length;
      ogwp = gwSum / t.opponents.length;
    }
    return {
      entrantId: e.id,
      rank: 0,
      points: t.points,
      wins: t.wins,
      losses: t.losses,
      draws: t.draws,
      matchesPlayed: t.matchesPlayed,
      gameWins: t.gameWins,
      gamesPlayed: t.gamesPlayed,
      mwp: flooredMwp(t),
      gwp: flooredGwp(t),
      omwp,
      ogwp,
      hadBye: t.hadBye,
      dropped: droppedById.get(e.id) ?? false,
    };
  });

  rows.sort((a, b) =>
    b.points - a.points ||
    b.omwp - a.omwp ||
    b.gwp - a.gwp ||
    b.ogwp - a.ogwp ||
    (hashTiebreak(seed, a.entrantId) < hashTiebreak(seed, b.entrantId) ? -1 : 1)
  );
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// ---------------------------------------------------------------------------
// Pairing

export interface PairRoundInput {
  // Standings in CURRENT order (computeStandings output). Dropped entrants are
  // skipped automatically.
  standings: Standing[];
  // ALL prior matches (any status) — pending pairings still block rematches,
  // and bye history comes from entrant2Id === null rows.
  priorMatches: SwissMatch[];
  // Seed for the round-1 shuffle. Same (standings, priorMatches, seed) →
  // identical output.
  seed: string;
}

export interface PairRoundResult {
  pairings: [string, string][]; // [entrant1Id, entrant2Id] in table order
  byeEntrantId: string | null;
}

// mulberry32 over an fnv1a hash of the seed string — tiny, deterministic,
// dependency-free. Quality is irrelevant here; reproducibility is the point.
function seededRng(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  const arr = [...items];
  const rng = seededRng(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Branch-and-bound minimum-rematch pairing over an ORDERED pool. The first
// unpaired entrant tries partners in pool order (so same-score-group pairings
// are preferred and odd group members float down to the head of the next
// group), backtracking on dead ends. Cost = number of rematches; the search
// first finds the 0-cost (rematch-free) pairing if one exists, and otherwise
// returns a minimum-rematch pairing — a round must never fail to pair. Fields
// are team-sized (≤ ~32), so the search is trivially fast in practice.
function minRematchPairing(
  pool: string[],
  priorOpponents: Map<string, Set<string>>
): [string, string][] {
  let best: [string, string][] | null = null;
  let bestCost = Infinity;

  const recurse = (remaining: string[], acc: [string, string][], cost: number) => {
    if (cost >= bestCost) return; // prune
    if (remaining.length === 0) {
      best = acc.map((p) => [...p] as [string, string]);
      bestCost = cost;
      return;
    }
    const a = remaining[0];
    for (let i = 1; i < remaining.length; i++) {
      const b = remaining[i];
      const rematch = priorOpponents.get(a)?.has(b) ? 1 : 0;
      if (cost + rematch >= bestCost) continue;
      const rest = remaining.filter((_, idx) => idx !== 0 && idx !== i);
      acc.push([a, b]);
      recurse(rest, acc, cost + rematch);
      acc.pop();
      if (bestCost === 0) return; // perfect pairing found — stop searching
    }
  };

  recurse(pool, [], 0);
  // pool.length is always even here; with ≥2 entrants a pairing always exists.
  return best ?? [];
}

export function pairRound({ standings, priorMatches, seed }: PairRoundInput): PairRoundResult {
  const active = standings.filter((s) => !s.dropped);

  const priorOpponents = new Map<string, Set<string>>();
  const hadBye = new Set<string>();
  for (const m of priorMatches) {
    if (m.entrant2Id === null) {
      hadBye.add(m.entrant1Id);
      continue;
    }
    if (!priorOpponents.has(m.entrant1Id)) priorOpponents.set(m.entrant1Id, new Set());
    if (!priorOpponents.has(m.entrant2Id)) priorOpponents.set(m.entrant2Id, new Set());
    priorOpponents.get(m.entrant1Id)!.add(m.entrant2Id);
    priorOpponents.get(m.entrant2Id)!.add(m.entrant1Id);
  }

  // Pool order: round 1 (no prior matches) = seeded shuffle; later rounds =
  // standings order. Grouping by points is implicit in standings order — the
  // ordered first-fit search prefers near neighbors, so same-group pairing +
  // float-down both fall out of it.
  let pool: string[];
  if (priorMatches.length === 0) {
    pool = seededShuffle(active.map((s) => s.entrantId), seed);
  } else {
    pool = active.map((s) => s.entrantId);
  }

  // Bye before pairing: lowest-ranked active entrant who hasn't had one;
  // if everyone has, the lowest-ranked outright. (Round 1: lowest = end of
  // the shuffled order — random, which is correct for round 1.)
  let byeEntrantId: string | null = null;
  if (pool.length % 2 === 1) {
    let pick = pool.length - 1;
    for (let i = pool.length - 1; i >= 0; i--) {
      if (!hadBye.has(pool[i])) { pick = i; break; }
    }
    byeEntrantId = pool[pick];
    pool = pool.filter((_, i) => i !== pick);
  }

  const pairings = minRematchPairing(pool, priorOpponents);
  return { pairings, byeEntrantId };
}

// UI hint for plannedRounds: standard Swiss round count.
export function suggestedRoundCount(entrantCount: number): number {
  return Math.ceil(Math.log2(Math.max(entrantCount, 2)));
}
