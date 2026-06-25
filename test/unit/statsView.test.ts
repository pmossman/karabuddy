import { describe, it, expect } from 'vitest';
import { filterMinGames, sortStatRows, winRatePct, type StatAccessors } from '@/lib/statsView';

const row = (name: string, games: number, wins: number, decisive: number) => ({ name, games, wins, decisive });
const acc: StatAccessors<ReturnType<typeof row>> = {
  count: (r) => r.games,
  winPct: (r) => winRatePct(r.wins, r.decisive),
  name: (r) => r.name,
};

describe('statsView helpers', () => {
  it('winRatePct rounds, null when no decisive games', () => {
    expect(winRatePct(3, 4)).toBe(75);
    expect(winRatePct(1, 3)).toBe(33);
    expect(winRatePct(0, 0)).toBeNull();
  });

  it('filterMinGames drops below threshold; min<=1 is a no-op', () => {
    const rows = [row('a', 1, 1, 1), row('b', 5, 3, 5), row('c', 3, 0, 3)];
    expect(filterMinGames(rows, 1, (r) => r.games).map((r) => r.name)).toEqual(['a', 'b', 'c']);
    expect(filterMinGames(rows, 3, (r) => r.games).map((r) => r.name)).toEqual(['b', 'c']);
    expect(filterMinGames(rows, 4, (r) => r.games).map((r) => r.name)).toEqual(['b']);
  });

  it('sortStatRows winrate: high% first; null win-rate sinks regardless of direction', () => {
    const rows = [row('low100', 1, 1, 1), row('solid60', 10, 6, 10), row('nodecisive', 8, 0, 0)];
    const desc = sortStatRows(rows, 'winrate', 'desc', acc).map((r) => r.name);
    expect(desc).toEqual(['low100', 'solid60', 'nodecisive']); // 100% > 60% > null(sinks)
    const asc = sortStatRows(rows, 'winrate', 'asc', acc).map((r) => r.name);
    expect(asc).toEqual(['solid60', 'low100', 'nodecisive']); // 60% < 100%, null STILL last
  });

  it('sortStatRows games asc/desc', () => {
    const rows = [row('a', 1, 1, 1), row('b', 10, 5, 10), row('c', 5, 2, 5)];
    expect(sortStatRows(rows, 'games', 'desc', acc).map((r) => r.name)).toEqual(['b', 'c', 'a']);
    expect(sortStatRows(rows, 'games', 'asc', acc).map((r) => r.name)).toEqual(['a', 'c', 'b']);
  });

  it('sortStatRows name asc (alphabetical)', () => {
    const rows = [row('Cad', 1, 1, 1), row('Aurra', 1, 1, 1), row('Boba', 1, 1, 1)];
    expect(sortStatRows(rows, 'name', 'asc', acc).map((r) => r.name)).toEqual(['Aurra', 'Boba', 'Cad']);
  });

  it('does not mutate the input array', () => {
    const rows = [row('a', 1, 1, 1), row('b', 10, 5, 10)];
    const before = rows.map((r) => r.name);
    sortStatRows(rows, 'games', 'desc', acc);
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});
