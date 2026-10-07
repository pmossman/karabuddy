import { describe, expect, it } from 'vitest';
import { baseUpgradesOf, decodeReplay, extractSeenCards, collapseReplay } from '@/lib/replayDecoder';
import { extractReplayFacts, aggregateCardEvents } from '@/lib/statsExtract';
import { computeEndGameStats } from '@/lib/endGameStats';
import { analyzeResourcing } from '@/lib/resourcingAnalysis';
import { frameSignature } from '@/lib/replaySignature';
import { buildMomentCard } from '@/lib/momentCard';
import { extractFrameCards, classifyStagedPlays, playKindOf, boardDefeats } from '@/app/(app)/r/[slug]/frameLog';
import { buildTimeline } from '@/app/(app)/r/[slug]/replayTimeline';
import { computeActionStops } from '@/app/(app)/r/[slug]/actionStops';
import { fortificationTabs } from '@/app/_components/_sharedcomponents/Cards/fortificationBand';
import { fortifyPayload, fortification, FORT, P1, P2, P1_BASE_UUID, P2_BASE_UUID } from '../fixtures/karabast-fortify';

// The fixture is shaped from forceteki's source (see its header): Fortify
// upgrades ride on players[pid].base.upgrades, zone 'base', parentCardId = the
// base uuid — never in a cardPiles entry.
const decoded = decodeReplay(fortifyPayload());
const frames = decoded.frames;
const fortsOn = (i: number, pid: string) => baseUpgradesOf(frames[i].state.players[pid]).map((c) => c.uuid);

describe('Fortify fixture through the real decoder', () => {
  it('keeps every fortification on its base, frame by frame', () => {
    expect(frames).toHaveLength(7);
    expect(frames.map((_, i) => fortsOn(i, P1).length)).toEqual([0, 1, 1, 1, 1, 1, 1]);
    expect(frames.map((_, i) => fortsOn(i, P2).length)).toEqual([2, 2, 3, 3, 4, 3, 3]);
    expect(fortsOn(5, P2)).toEqual([FORT.darkSanctum, FORT.militaryAcademy, FORT.intelAgency]);
    const asg = frames[1].state.players[P1].base.upgrades[0];
    expect(asg).toMatchObject({ zone: 'base', parentCardId: P1_BASE_UUID, controllerId: P1, type: 'upgrade', setId: { set: 'HMW', number: 81 } });
  });

  it('never files a fortification in a card pile', () => {
    const fortUuids = new Set<string>(Object.values(FORT));
    for (const f of frames) {
      for (const pid of [P1, P2]) {
        for (const [pile, list] of Object.entries(f.state.players[pid].cardPiles as Record<string, any[]>)) {
          if (pile === 'hand' || pile === 'discard') continue;
          expect(list.filter((c) => fortUuids.has(c?.uuid))).toEqual([]);
        }
      }
    }
  });

  it('survives the undo / board-static collapse (each fortification change is its own frame)', () => {
    expect(collapseReplay(decoded).frames).toHaveLength(7);
  });

  it('baseUpgradesOf tolerates replays recorded before HMW', () => {
    expect(baseUpgradesOf({ base: { uuid: 'b' } })).toEqual([]);
    expect(baseUpgradesOf({})).toEqual([]);
    expect(baseUpgradesOf(null)).toEqual([]);
    expect(baseUpgradesOf({ base: { upgrades: [null, { uuid: 'u' }] } })).toEqual([{ uuid: 'u' }]);
  });
});

describe('Fortify across the replay surfaces', () => {
  it('seen cards: the opponent’s fortifications count, including one never defeated', () => {
    const ids = extractSeenCards(frames, P2).map((c) => c.id).sort();
    expect(ids).toEqual(expect.arrayContaining(['HMW_070', 'HMW_112', 'HMW_113', 'HMW_205']));
    expect(extractSeenCards(frames, P2).find((c) => c.id === 'HMW_113')?.count).toBe(1); // base then discard: one copy
  });

  it('card events: played from the log, defeated from the base counts as discarded', () => {
    const { cardEvents, observedCards } = extractReplayFacts(decoded, { gameId: 'g', winners: null, ownerPlayerId: P1, durationMs: null });
    const byside = aggregateCardEvents(cardEvents);
    expect(byside.get(P1)?.played).toMatchObject({ HMW_081: 1, SOR_251: 5 });
    expect(byside.get(P2)?.played).toMatchObject({ HMW_113: 2, HMW_205: 4 });
    // Sinister War Memorial left Bob's base for his discard: a defeat, not an event resolving.
    expect(byside.get(P2)?.discarded).toEqual({ HMW_113: 5 });
    // Confiscate resolved (a played event) — still not a discard.
    expect(byside.get(P1)?.discarded).toBeUndefined();
    // The catalog self-heal sees a fortification that never left its base.
    expect(observedCards.map((c) => c.cardId)).toEqual(expect.arrayContaining(['HMW_070', 'HMW_112', 'HMW_205']));
  });

  it('end-game stats: a fortification is a card played, and its defeat is not a unit kill', () => {
    const stats = computeEndGameStats(frames, null)!;
    const p1 = stats.players.find((p) => p.playerId === P1)!;
    const p2 = stats.players.find((p) => p.playerId === P2)!;
    expect(p1.cardsPlayed).toBe(2); // Battlefield Marine (on board at f0) + Alliance Shield Generator
    expect(p2.cardsPlayed).toBe(6); // Stormtrooper, TIE, and four fortifications
    expect(p1.unitsDefeated).toBe(0); // Confiscate defeated an upgrade, not a unit
  });

  it('resourcing: a played fortification is not a dead card', () => {
    const report = analyzeResourcing(frames, { recorderId: P1, costOf: () => null });
    expect(report.deadCards.map((d) => d.cardId)).not.toContain('HMW_081');
    expect(report.rounds.flatMap((r) => r.plays)).toContain('HMW_081');
  });

  it('frame signature: playing a fortification is a different public moment', () => {
    const state = structuredClone(frames[0].state);
    const before = frameSignature(state);
    state.players[P1].base.upgrades = [fortification('shieldGenerator', FORT.shieldGenerator, P1)];
    expect(frameSignature(state)).not.toBe(before);
  });

  it('action stops: the play and the defeat are both stops', () => {
    const stops = computeActionStops(frames, decoded.activeByFrame);
    for (const i of [1, 2, 4, 5]) expect(stops).toContain(i);
  });

  it('moment card: still renders both sides (it shows units only, so fortifications are omitted like unit upgrades)', () => {
    const m = buildMomentCard({ decoded, ownerPlayerId: P1, frameIndexOriginal: 4 });
    expect(m.matchup.bottom.base?.name).toBe('Dune Sea');
    expect(m.matchup.top.base?.damage).toBe(8);
    expect(m.matchup.top.ground.map((u) => u.name)).toEqual(['Death Star Stormtrooper']);
  });
});

describe('Fortify in the viewer’s frame reading', () => {
  it('extractFrameCards lists fortifications as on-base upgrades', () => {
    const { cards, leaders } = extractFrameCards(frames[1].state);
    expect(cards.get(FORT.shieldGenerator)).toMatchObject({ zone: 'base', ctrl: P1, parentCardId: P1_BASE_UUID, onBase: true });
    expect(cards.get(FORT.darkSanctum)).toMatchObject({ zone: 'base', ctrl: P2, parentCardId: P2_BASE_UUID, onBase: true });
    expect(leaders.has(FORT.shieldGenerator)).toBe(false);
    expect(playKindOf(cards.get(FORT.shieldGenerator))).toBe('upgrade');
  });

  it('a fortification play is a staged upgrade, for both seats', () => {
    expect(classifyStagedPlays(frames[1].state)).toEqual({ events: 0, upgrades: 1 }); // Alice, own hand
    expect(classifyStagedPlays(frames[2].state)).toEqual({ events: 0, upgrades: 1 }); // Bob, hidden hand
    expect(classifyStagedPlays(frames[5].state)).toEqual({ events: 1, upgrades: 0 }); // Confiscate
  });

  it('the timeline budgets an upgrade beat for each fortification play', () => {
    const tl = buildTimeline(frames);
    for (const i of [1, 2, 4]) expect(tl[i].anims.map((a) => a.kind)).toContain('upgrade');
    expect(tl[3].anims.map((a) => a.kind)).not.toContain('upgrade');
  });

  it('a defeated fortification is not a unit defeat beat', () => {
    expect(boardDefeats(frames[4].state, frames[5].state)).toEqual([]);
  });
});

describe('fortificationTabs', () => {
  it('names up to three, then collapses the oldest into the chip', () => {
    expect(fortificationTabs([])).toEqual({ collapsed: [], shown: [] });
    expect(fortificationTabs(['a'])).toEqual({ collapsed: [], shown: ['a'] });
    expect(fortificationTabs(['a', 'b', 'c'])).toEqual({ collapsed: [], shown: ['a', 'b', 'c'] });
    expect(fortificationTabs(['a', 'b', 'c', 'd'])).toEqual({ collapsed: ['a', 'b'], shown: ['c', 'd'] });
    expect(fortificationTabs(['a', 'b', 'c', 'd', 'e'])).toEqual({ collapsed: ['a', 'b', 'c'], shown: ['d', 'e'] });
  });
});
