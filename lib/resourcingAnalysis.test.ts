import { describe, it, expect } from 'vitest';
import { analyzeResourcing } from './resourcingAnalysis';
import type { Frame } from './replayDecoder';

// Cards: P played; CLOG held-dead; BUR resourced-then-dead; ALT held-dead (the
// expendable alternative). Costs injected.
const COST: Record<string, number> = { SOR_001: 5, SOR_002: 6, SOR_003: 2, SOR_004: 3 };
const costOf = (id: string) => COST[id] ?? null;
const card = (id: string, uuid: string) => ({ uuid, setId: { set: id.split('_')[0], number: Number(id.split('_')[1]) }, id });
const P = () => card('SOR_001', 'p');
const CLOG = () => card('SOR_002', 'clog');
const BUR = () => card('SOR_003', 'bur');
const ALT = () => card('SOR_004', 'alt');

const action = (piles: any, avail: number, msgs: any[] = []): Frame =>
  ({ t: 0, state: { phase: 'action', newMessages: msgs, players: { me: { user: { username: 'Me' }, availableResources: avail, cardPiles: piles }, opp: { cardPiles: {} } } } } as any);
const regroup = (): Frame => ({ t: 0, state: { phase: 'regroup', newMessages: [], players: { me: { user: { username: 'Me' }, cardPiles: {} }, opp: { cardPiles: {} } } } } as any);
const initMsg = [{ message: ['Me', ' claims initiative and passes'] }];

// 5 single-action-frame rounds separated by regroup.
const frames: Frame[] = [
  action({ hand: [P(), CLOG(), BUR()], resources: [], groundArena: [] }, 0), // R0 spent
  regroup(),
  action({ hand: [CLOG()], resources: [BUR()], groundArena: [P()] }, 0), // R1 spent: played P, resourced BUR
  regroup(),
  action({ hand: [CLOG(), ALT()], resources: [BUR()], groundArena: [P()] }, 3), // R2 forced-stuck, float 3
  regroup(),
  action({ hand: [CLOG(), ALT()], resources: [BUR()], groundArena: [P()] }, 2, initMsg), // R3 initiative, float 2
  regroup(),
  action({ hand: [CLOG(), ALT()], resources: [BUR()], groundArena: [P()] }, 5), // R4 FINAL, float 5 (dropped)
];

describe('analyzeResourcing', () => {
  const r = analyzeResourcing(frames, { recorderId: 'me', costOf });

  it('classifies each round by float reason', () => {
    expect(r.rounds.map((x) => x.reason)).toEqual(['spent', 'spent', 'forced-stuck', 'initiative', 'forced-stuck']);
    expect(r.rounds[4].isFinal).toBe(true);
  });

  it('splits float by reason, excluding initiative + the decided (final) round from the penalty', () => {
    expect(r.floatByReason).toEqual({ initiative: 2, forced: 3, underspend: 0 });
    expect(r.floatTotal).toBe(10); // 0+0+3+2+5 — total still counts everything
  });

  it('lists dead cards (drawn, no copy ever played) — not the played one', () => {
    const ids = r.deadCards.map((d) => d.cardId).sort();
    expect(ids).toEqual(['SOR_002', 'SOR_003', 'SOR_004']);
  });

  it('flags the held-dead-card clog (Signal A)', () => {
    const clog = r.flags.find((f) => f.kind === 'clog' && f.cardId === 'SOR_002');
    expect(clog).toBeDefined();
    expect((clog as any).floatedWhileHeld).toBe(3);
  });

  it('flags buried-and-needed only with an expendable alternative (Signal B)', () => {
    const buried = r.flags.find((f) => f.kind === 'buried');
    expect(buried).toBeDefined();
    expect((buried as any).cardId).toBe('SOR_003'); // resourced R2, cost 2 ≤ float 3
    expect((buried as any).round).toBe(3); // R2 (0-based) → round 3
    expect((buried as any).alternativeCardId).toBeTruthy();
  });

  it('infers the recorder from the real-hand player when not given', () => {
    const r2 = analyzeResourcing(frames, { costOf });
    expect(r2.recorderId).toBe('me');
    expect(r2.username).toBe('Me');
  });
});
