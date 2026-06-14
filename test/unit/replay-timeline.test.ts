import { describe, it, expect } from 'vitest';
import { buildTimeline } from '@/app/(app)/r/[slug]/replayTimeline';
import { dwellFor, LEADER_DEPLOY_FULL_MS, UNIT_PLAY_TOTAL_MS, UPGRADE_TOTAL_MS, RESOURCE_TOTAL_MS, PLAYBACK_TICK_MS } from '@/app/(app)/r/[slug]/animationTiming';

// B147 / ADR 0008: the timeline is the single classifier — geometry-free anim
// specs + per-beat duration, derived from board diff ∪ log so a stripped log
// can't hide a deploy/play. These pin the detection that drives the dwell (and,
// later, the planner + renderer).

const frame = (state: any) => ({ state }) as any;
const card = (uuid: string, zone: string, extra: any = {}) => ({ uuid, zone, controllerId: 'p1', ...extra });
const mk = (opts: { leaderZone?: string; ground?: any[]; hand?: any[]; resources?: any[]; msgs?: any[] }) =>
  frame({
    newMessages: opts.msgs ?? [],
    players: {
      p1: {
        user: { username: 'Alice' },
        leader: { uuid: 'L', zone: opts.leaderZone ?? 'base', controllerId: 'p1' },
        cardPiles: { groundArena: opts.ground ?? [], spaceArena: [], hand: opts.hand ?? [], resources: opts.resources ?? [], discard: [] },
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
