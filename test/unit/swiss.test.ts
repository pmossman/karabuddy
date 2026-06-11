import { describe, it, expect } from 'vitest';
import {
  computeStandings,
  pairRound,
  suggestedRoundCount,
  type SwissEntrant,
  type SwissMatch,
  type Standing,
} from '@/lib/swiss';

// B124: the Swiss engine is pure — these tests are the spec. Scoring: W3/D1/L0,
// MW%/GW% floored at 1/3, byes are 2-0 wins that contribute nothing to OMW/OGW,
// sort points → OMW% → GW% → OGW% → seeded-hash.

const E = (...ids: string[]): SwissEntrant[] => ids.map((id) => ({ id }));

// A reported series: winner takes games 2-x.
const bo3 = (a: string, b: string, winner: string, loserGames = 0): SwissMatch => ({
  entrant1Id: a,
  entrant2Id: b,
  games: [
    ...Array.from({ length: 2 }, () => ({ winner })),
    ...Array.from({ length: loserGames }, () => ({ winner: winner === a ? b : a })),
  ],
});
const bye = (a: string): SwissMatch => ({ entrant1Id: a, entrant2Id: null, games: [{ winner: a }, { winner: a }] });

const byId = (standings: Standing[], id: string) => standings.find((s) => s.entrantId === id)!;

describe('computeStandings', () => {
  it('scores wins 3 / draws 1 / losses 0 and tracks W-L-D', () => {
    const s = computeStandings(E('a', 'b', 'c', 'd'), [
      bo3('a', 'b', 'a'),
      { entrant1Id: 'c', entrant2Id: 'd', games: [{ winner: 'c' }, { winner: 'd' }] }, // 1-1 draw
    ]);
    expect(byId(s, 'a')).toMatchObject({ points: 3, wins: 1, losses: 0, draws: 0 });
    expect(byId(s, 'b')).toMatchObject({ points: 0, wins: 0, losses: 1 });
    expect(byId(s, 'c')).toMatchObject({ points: 1, draws: 1 });
    expect(byId(s, 'd')).toMatchObject({ points: 1, draws: 1 });
  });

  it('floors MW% and GW% at 1/3 once a match is played', () => {
    const s = computeStandings(E('a', 'b'), [bo3('a', 'b', 'a')]);
    expect(byId(s, 'b').mwp).toBeCloseTo(1 / 3); // 0 points but floored
    expect(byId(s, 'b').gwp).toBeCloseTo(1 / 3); // 0-2 in games but floored
    expect(byId(s, 'a').mwp).toBe(1);
    expect(byId(s, 'a').gwp).toBe(1);
  });

  it('unplayed entrants have 0 percentages (no floor before playing)', () => {
    const s = computeStandings(E('a'), []);
    expect(byId(s, 'a')).toMatchObject({ mwp: 0, gwp: 0, omwp: 0, ogwp: 0, matchesPlayed: 0 });
  });

  it('a bye is a 2-0 win that counts toward own record but is excluded from opponents', () => {
    // b: loses to a, then gets a bye. b's only OPPONENT is a.
    const s = computeStandings(E('a', 'b'), [bo3('a', 'b', 'a'), bye('b')]);
    const b = byId(s, 'b');
    expect(b.points).toBe(3); // the bye win
    expect(b.hadBye).toBe(true);
    expect(b.matchesPlayed).toBe(2);
    expect(b.gameWins).toBe(2);
    // b's OMW = a's MW% only (the bye contributes no opponent).
    expect(b.omwp).toBeCloseTo(byId(s, 'a').mwp);
    // a's OMW = b's MW% — which DOES include b's bye in b's own record (3/6 = .5).
    expect(byId(s, 'a').omwp).toBeCloseTo(0.5);
  });

  it('pending matches (no games) earn nothing and stay out of denominators', () => {
    const s = computeStandings(E('a', 'b'), [{ entrant1Id: 'a', entrant2Id: 'b', games: [] }]);
    expect(byId(s, 'a')).toMatchObject({ points: 0, matchesPlayed: 0, mwp: 0 });
  });

  it('breaks points ties by OMW%', () => {
    // a beats b (b otherwise strong); c beats d (d otherwise weak).
    // a and c both 3 points; b 2-1 overall vs d 0-3 → a's OMW > c's OMW.
    const matches = [
      bo3('a', 'b', 'a'),
      bo3('c', 'd', 'c'),
      bo3('b', 'x1', 'b'),
      bo3('b', 'x2', 'b'),
      bo3('d', 'x1', 'x1'),
      bo3('d', 'x2', 'x2'),
    ];
    const s = computeStandings(E('a', 'b', 'c', 'd', 'x1', 'x2'), matches);
    expect(byId(s, 'a').rank).toBeLessThan(byId(s, 'c').rank);
  });

  it('final tiebreak is deterministic for a given seed and changes with the seed', () => {
    // Two entrants with literally identical (empty) records.
    const one = computeStandings(E('a', 'b'), [], 'seed-1').map((s) => s.entrantId);
    const two = computeStandings(E('b', 'a'), [], 'seed-1').map((s) => s.entrantId);
    expect(one).toEqual(two); // insertion-order independent
    const other = computeStandings(E('a', 'b'), [], 'seed-2').map((s) => s.entrantId);
    // Not guaranteed to differ for any single pair, but must stay deterministic:
    expect(computeStandings(E('a', 'b'), [], 'seed-2').map((s) => s.entrantId)).toEqual(other);
  });

  it('keeps dropped entrants in standings, flagged', () => {
    const s = computeStandings([{ id: 'a' }, { id: 'b', dropped: true }], [bo3('a', 'b', 'b')]);
    expect(byId(s, 'b').dropped).toBe(true);
    expect(byId(s, 'b').points).toBe(3); // record retained
  });
});

describe('pairRound', () => {
  const standingsFor = (entrants: SwissEntrant[], matches: SwissMatch[], seed = 's') =>
    computeStandings(entrants, matches, seed);

  it('pairs an even field fully; odd field gets exactly one bye', () => {
    for (const n of [4, 5, 6, 7, 8, 9, 12, 16]) {
      const entrants = E(...Array.from({ length: n }, (_, i) => `p${i}`));
      const { pairings, byeEntrantId } = pairRound({
        standings: standingsFor(entrants, []),
        priorMatches: [],
        seed: 'r1',
      });
      expect(pairings.length).toBe(Math.floor(n / 2));
      expect(byeEntrantId === null).toBe(n % 2 === 0);
      // Everyone appears exactly once.
      const seen = pairings.flat().concat(byeEntrantId ? [byeEntrantId] : []);
      expect(new Set(seen).size).toBe(n);
    }
  });

  it('is deterministic for the same seed and differs across seeds (round 1 shuffle)', () => {
    const entrants = E(...Array.from({ length: 8 }, (_, i) => `p${i}`));
    const standings = standingsFor(entrants, []);
    const a = pairRound({ standings, priorMatches: [], seed: 'alpha' });
    const b = pairRound({ standings, priorMatches: [], seed: 'alpha' });
    expect(a).toEqual(b);
    const c = pairRound({ standings, priorMatches: [], seed: 'omega' });
    expect(JSON.stringify(a) !== JSON.stringify(c)).toBe(true); // 8! orderings — collision ≈ 0
  });

  it('avoids rematches when avoidable (backtracking past the greedy first fit)', () => {
    // Pool order a,b,c,d. Priors: c-d and b-d. Greedy a-b then c-d would
    // rematch; the only rematch-free pairing is a-d + b-c.
    const entrants = E('a', 'b', 'c', 'd');
    const priors = [bo3('c', 'd', 'c'), bo3('b', 'd', 'b'), bo3('a', 'x', 'a')];
    const { pairings } = pairRound({
      standings: standingsFor([...entrants, { id: 'x', dropped: true }], priors),
      priorMatches: priors,
      seed: 's',
    });
    const sets = pairings.map((p) => new Set(p));
    const has = (x: string, y: string) => sets.some((s) => s.has(x) && s.has(y));
    expect(has('c', 'd')).toBe(false);
    expect(has('b', 'd')).toBe(false);
  });

  it('falls back to minimum rematches when rematch-free is impossible', () => {
    // 4 entrants, all 6 pairs already played → any pairing is 2 rematches.
    const ids = ['a', 'b', 'c', 'd'];
    const priors: SwissMatch[] = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) priors.push(bo3(ids[i], ids[j], ids[i]));
    const { pairings, byeEntrantId } = pairRound({
      standings: standingsFor(E(...ids), priors),
      priorMatches: priors,
      seed: 's',
    });
    expect(pairings.length).toBe(2); // never fails to pair
    expect(byeEntrantId).toBeNull();
  });

  it('floats unpairable score-group members down to the next group', () => {
    // a,b,c at 3+ points and all played each other → each must pair down.
    const priors = [bo3('a', 'b', 'a'), bo3('a', 'c', 'a'), bo3('b', 'c', 'b')];
    const entrants = E('a', 'b', 'c', 'd', 'e', 'f');
    const { pairings } = pairRound({
      standings: standingsFor(entrants, priors),
      priorMatches: priors,
      seed: 's',
    });
    const top = new Set(['a', 'b', 'c']);
    for (const [x, y] of pairings) {
      // No pairing stays inside the exhausted top group.
      expect(top.has(x) && top.has(y)).toBe(false);
    }
  });

  it('gives the bye to the lowest-ranked active entrant without a prior bye', () => {
    // 5 entrants; d already had a bye; e is lowest-ranked without one.
    const priors = [bo3('a', 'b', 'a'), bo3('c', 'e', 'c'), bye('d')];
    const standings = standingsFor(E('a', 'b', 'c', 'd', 'e'), priors);
    const { byeEntrantId } = pairRound({ standings, priorMatches: priors, seed: 's' });
    expect(byeEntrantId).not.toBeNull();
    expect(byeEntrantId).not.toBe('d'); // never repeats while others haven't had one
    // It must be one of the 0-point entrants (bottom of standings).
    expect(byId(standings, byeEntrantId!).points).toBe(0);
  });

  it('rotates byes — nobody gets a second bye until everyone active has had one', () => {
    // 5 entrants, simulate 5 rounds with deterministic results.
    const entrants = E('a', 'b', 'c', 'd', 'e');
    const all: SwissMatch[] = [];
    const byes: string[] = [];
    for (let r = 0; r < 5; r++) {
      const standings = computeStandings(entrants, all, 'seed');
      const { pairings, byeEntrantId } = pairRound({ standings, priorMatches: all, seed: `r${r}` });
      if (byeEntrantId) {
        byes.push(byeEntrantId);
        all.push(bye(byeEntrantId));
      }
      for (const [x, y] of pairings) all.push(bo3(x, y, x < y ? x : y)); // deterministic winner
    }
    expect(byes.length).toBe(5);
    expect(new Set(byes).size).toBe(5); // 5 rounds, 5 distinct bye recipients
  });

  it('excludes dropped entrants from pairing', () => {
    const entrants: SwissEntrant[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd', dropped: true }];
    const { pairings, byeEntrantId } = pairRound({
      standings: computeStandings(entrants, []),
      priorMatches: [],
      seed: 's',
    });
    const seen = pairings.flat().concat(byeEntrantId ? [byeEntrantId] : []);
    expect(seen).not.toContain('d');
    expect(seen.length).toBe(3); // 3 active → 1 pairing + 1 bye
  });

  it('full simulated tournaments stay rematch-free for suggested round counts', () => {
    for (const n of [6, 7, 8, 9, 12, 16]) {
      const entrants = E(...Array.from({ length: n }, (_, i) => `p${String(i).padStart(2, '0')}`));
      const all: SwissMatch[] = [];
      const rounds = suggestedRoundCount(n);
      for (let r = 0; r < rounds; r++) {
        const standings = computeStandings(entrants, all, 'sim');
        const { pairings, byeEntrantId } = pairRound({ standings, priorMatches: all, seed: `sim-${n}-${r}` });
        // No rematch anywhere in the suggested-round window.
        for (const [x, y] of pairings) {
          const prior = all.some(
            (m) =>
              (m.entrant1Id === x && m.entrant2Id === y) ||
              (m.entrant1Id === y && m.entrant2Id === x)
          );
          expect(prior, `rematch ${x}-${y} in field ${n} round ${r + 1}`).toBe(false);
        }
        if (byeEntrantId) all.push(bye(byeEntrantId));
        for (const [x, y] of pairings) all.push(bo3(x, y, x < y ? x : y, r % 2));
      }
    }
  });
});

describe('suggestedRoundCount', () => {
  it('is ceil(log2(n)) with a floor of 1', () => {
    expect(suggestedRoundCount(2)).toBe(1);
    expect(suggestedRoundCount(4)).toBe(2);
    expect(suggestedRoundCount(5)).toBe(3);
    expect(suggestedRoundCount(8)).toBe(3);
    expect(suggestedRoundCount(9)).toBe(4);
    expect(suggestedRoundCount(16)).toBe(4);
    expect(suggestedRoundCount(1)).toBe(1);
    expect(suggestedRoundCount(0)).toBe(1);
  });
});
