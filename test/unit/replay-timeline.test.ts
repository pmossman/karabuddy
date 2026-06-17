import { describe, it, expect } from 'vitest';
import { buildTimeline } from '@/app/(app)/r/[slug]/replayTimeline';
import { dwellFor, LEADER_DEPLOY_FULL_MS, UNIT_PLAY_TOTAL_MS, UPGRADE_TOTAL_MS, RESOURCE_TOTAL_MS, PLAYBACK_TICK_MS } from '@/app/(app)/r/[slug]/animationTiming';

// B147 / ADR 0008: the timeline is the single classifier — geometry-free anim
// specs + per-beat duration, derived from board diff ∪ log so a stripped log
// can't hide a deploy/play. These pin the detection that drives the dwell (and,
// later, the planner + renderer).

const frame = (state: any) => ({ state }) as any;
const card = (uuid: string, zone: string, extra: any = {}) => ({ uuid, zone, controllerId: 'p1', ...extra });
const mk = (opts: { leaderZone?: string; ground?: any[]; hand?: any[]; resources?: any[]; discard?: any[]; msgs?: any[] }) =>
  frame({
    newMessages: opts.msgs ?? [],
    players: {
      p1: {
        user: { username: 'Alice' },
        leader: { uuid: 'L', zone: opts.leaderZone ?? 'base', controllerId: 'p1' },
        cardPiles: { groundArena: opts.ground ?? [], spaceArena: [], hand: opts.hand ?? [], resources: opts.resources ?? [], discard: opts.discard ?? [] },
      },
    },
  });

const kinds = (beat: any) => beat.anims.map((a: any) => a.kind).sort();

describe('buildTimeline — board-diff detection (robust to a stripped log)', () => {
  it('detects a leader deploy (base → arena) with an empty log', () => {
    const tl = buildTimeline([mk({ leaderZone: 'base' }), mk({ leaderZone: 'groundArena' })]);
    expect(kinds(tl[1])).toContain('leaderDeploy');
    expect(tl[1].durationMs).toBe(dwellFor(LEADER_DEPLOY_FULL_MS));
  });

  it('detects a unit play (hand → arena) with an empty log', () => {
    const tl = buildTimeline([
      mk({ hand: [card('U', 'hand')] }),
      mk({ ground: [card('U', 'groundArena')] }),
    ]);
    expect(kinds(tl[1])).toContain('play');
    expect(tl[1].durationMs).toBe(dwellFor(UNIT_PLAY_TOTAL_MS));
  });

  it('detects an upgrade tuck (new arena card with parentCardId)', () => {
    const tl = buildTimeline([
      mk({ ground: [card('V', 'groundArena')] }),
      mk({ ground: [card('V', 'groundArena'), card('U', 'groundArena', { parentCardId: 'V' })] }),
    ]);
    expect(kinds(tl[1])).toContain('upgrade');
    expect(tl[1].durationMs).toBe(dwellFor(UPGRADE_TOTAL_MS));
  });

  it('detects resourcing via resource-pile growth (no log line)', () => {
    const tl = buildTimeline([
      mk({ resources: [card('r1', 'resource')] }),
      mk({ resources: [card('r1', 'resource'), card('r2', 'resource')] }),
    ]);
    expect(kinds(tl[1])).toContain('resource');
    expect(tl[1].durationMs).toBe(dwellFor(RESOURCE_TOTAL_MS));
  });

  it('budgets the LONGEST beat when several animate at once (deploy + play)', () => {
    const tl = buildTimeline([
      mk({ leaderZone: 'base', hand: [card('U', 'hand')] }),
      mk({ leaderZone: 'groundArena', ground: [card('U', 'groundArena')] }),
    ]);
    expect(kinds(tl[1])).toEqual(['leaderDeploy', 'play']);
    expect(tl[1].durationMs).toBe(dwellFor(LEADER_DEPLOY_FULL_MS)); // deploy > play
  });

  it('a settle frame with no board change is the bare tick', () => {
    const tl = buildTimeline([mk({ leaderZone: 'groundArena' }), mk({ leaderZone: 'groundArena' })]);
    expect(tl[1].anims).toEqual([]);
    expect(tl[1].durationMs).toBe(PLAYBACK_TICK_MS);
  });
});

describe('buildTimeline — actor (forward-filled, for the handoff pause)', () => {
  it('reads the log actor, then forward-fills onto consequence frames', () => {
    const acted = mk({ leaderZone: 'base', msgs: [{ message: [{ type: 'player', name: 'Alice' }, ' deploys'] }] });
    const settle = mk({ leaderZone: 'base' }); // no log
    const tl = buildTimeline([acted, settle]);
    expect(tl[0].actor).toBe('Alice');
    expect(tl[1].actor).toBe('Alice'); // forward-filled
  });
});

// B161: defeat detection from the board diff (a unit arena → discard). Catches
// the ~29% of defeats the recorder logged no line for (event / indirect damage).
describe('buildTimeline — defeat detection', () => {
  it('emits a defeat beat for a unit that left the arena for the discard (silent, no log)', () => {
    const tl = buildTimeline([
      mk({ ground: [card('U', 'groundArena')] }),
      mk({ discard: [card('U', 'discard')] }),
    ]);
    expect(kinds(tl[1])).toContain('defeat');
    expect(tl[1].anims.find((a: any) => a.kind === 'defeat')?.uuid).toBe('U');
  });

  it('does NOT double-count a unit an attack on the same frame killed (lunge covers it)', () => {
    const tl = buildTimeline([
      mk({ ground: [card('A', 'groundArena'), card('V', 'groundArena')] }),
      mk({ ground: [card('A', 'groundArena', { isAttacker: true })], discard: [card('V', 'discard')] }),
    ]);
    expect(kinds(tl[1])).toContain('attack');
    expect(kinds(tl[1])).not.toContain('defeat');
  });

  it('does not double-count a TRADE: the dead attacker gets no defeat beat (its lunge covers it)', () => {
    const tradeLog = [{ message: [{ type: 'player', name: 'Alice' }, ' attacks ', { type: 'card', uuid: 'V' }, ' with ', { type: 'card', uuid: 'A' }] }];
    const tl = buildTimeline([
      mk({ ground: [card('A', 'groundArena'), card('V', 'groundArena')] }),
      mk({ discard: [card('A', 'discard'), card('V', 'discard')], msgs: tradeLog }), // both die
    ]);
    expect(kinds(tl[1])).toContain('attack');
    expect(kinds(tl[1])).not.toContain('defeat'); // neither A (attacker) nor V (target)
  });

  it('ignores an upgrade following its host to discard (not its own death)', () => {
    const tl = buildTimeline([
      mk({ ground: [card('Up', 'groundArena', { parentCardId: 'Host' })] }),
      mk({ discard: [card('Up', 'discard', { parentCardId: 'Host' })] }),
    ]);
    expect(kinds(tl[1])).not.toContain('defeat');
  });

  it('ignores a unit bounced to hand (left the arena, but not defeated)', () => {
    const tl = buildTimeline([
      mk({ ground: [card('U', 'groundArena')] }),
      mk({ hand: [card('U', 'hand')] }),
    ]);
    expect(kinds(tl[1])).not.toContain('defeat');
  });
});
