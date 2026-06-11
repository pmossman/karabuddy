import { describe, it, expect } from 'vitest';
import { suggestResult, type CandidateReplay } from '@/lib/tournamentResults';

// B124/P4: replay→result derivation. e1/e2 are the paired (account-linked)
// entrants; replays carry the uploader's userId + side + winners.

const e1 = { id: 'te_alice', userId: 'user-alice' };
const e2 = { id: 'te_bob', userId: 'user-bob' };
const ROUND_START = '2026-06-11T10:00:00Z';
const after = (mins: number) => new Date(Date.parse(ROUND_START) + mins * 60_000).toISOString();

// A replay uploaded by Alice where p1 = her side; winnerSide 'mine' | 'theirs'.
function rep(opts: Partial<CandidateReplay> & { slug: string }): CandidateReplay {
  return {
    createdAt: after(10),
    uploaderUserId: 'user-alice',
    participantUserIds: [],
    ownerPlayerId: 'p1',
    altOwnerPlayerId: null,
    winners: ['p1'],
    lobbyId: 'lobby-1',
    sharedToTeam: false,
    ...opts,
  };
}

const suggest = (replays: CandidateReplay[]) =>
  suggestResult({ entrant1: e1, entrant2: e2, roundStartedAt: ROUND_START, replays });

describe('suggestResult', () => {
  it('maps the uploader winning/losing to the right entrants across a Bo3', () => {
    const s = suggest([
      rep({ slug: 'r1', createdAt: after(1), winners: ['p1'] }), // alice wins
      rep({ slug: 'r2', createdAt: after(2), winners: ['p2'] }), // alice loses
      rep({ slug: 'r3', createdAt: after(3), winners: ['p1'] }), // alice wins
    ]);
    expect(s).not.toBeNull();
    expect(s!.score).toBe('2-1');
    expect(s!.games.map((g) => g.winner)).toEqual([e1.id, e2.id, e1.id]);
    expect(s!.games.map((g) => g.replaySlug)).toEqual(['r1', 'r2', 'r3']); // createdAt order
    expect(s!.confidence).toBe('high');
  });

  it('returns null with no eligible replays', () => {
    expect(suggest([])).toBeNull();
    // Uploaded by an unrelated user, not shared.
    expect(suggest([rep({ slug: 'rx', uploaderUserId: 'user-other' })])).toBeNull();
  });

  it('excludes replays from before the round started', () => {
    expect(suggest([rep({ slug: 'old', createdAt: '2026-06-11T09:00:00Z' })])).toBeNull();
  });

  it('a participant-linked replay needs a team share OR an entrant uploader', () => {
    // Bob is a PARTICIPANT (alt recording linked to him) but the uploader is a
    // stranger and the replay isn't shared with the team → ineligible.
    const notShared = rep({ slug: 'r1', uploaderUserId: 'user-other', participantUserIds: ['user-bob'], altOwnerPlayerId: 'p2', winners: ['p2'] });
    expect(suggest([notShared])).toBeNull();
    // Same replay shared to the team → eligible; bob's side p2 won → bob.
    const s = suggest([{ ...notShared, sharedToTeam: true }]);
    expect(s!.games[0].winner).toBe(e2.id);
  });

  it('no winner signal → game suggested with null winner, low confidence', () => {
    const s = suggest([rep({ slug: 'r1', winners: null })]);
    expect(s!.games[0].winner).toBeNull();
    expect(s!.confidence).toBe('low');
  });

  it('double-sided recordings that agree stay high confidence; disagreement nulls the game', () => {
    // Alice uploaded (her side p1), Bob linked as participant (his side p2).
    const agreeing = rep({ slug: 'r1', participantUserIds: ['user-bob'], altOwnerPlayerId: 'p2', winners: ['p1'] });
    let s = suggest([agreeing]);
    expect(s!.games[0].winner).toBe(e1.id);
    expect(s!.confidence).toBe('high');

    // Corrupt: winners contains BOTH sides — the verdicts disagree.
    const conflicted = rep({ slug: 'r2', participantUserIds: ['user-bob'], altOwnerPlayerId: 'p2', winners: ['p1', 'p2'] });
    s = suggest([conflicted]);
    expect(s!.games[0].winner).toBeNull();
    expect(s!.confidence).toBe('low');
  });

  it('picks the lobby group with the most games and ignores strays', () => {
    const s = suggest([
      rep({ slug: 'stray', lobbyId: 'lobby-other', createdAt: after(50), winners: ['p2'] }),
      rep({ slug: 'g1', lobbyId: 'lobby-main', createdAt: after(1) }),
      rep({ slug: 'g2', lobbyId: 'lobby-main', createdAt: after(2) }),
    ]);
    expect(s!.games.map((g) => g.replaySlug)).toEqual(['g1', 'g2']);
    expect(s!.score).toBe('2-0');
  });

  it('ties between equal-size lobby groups go to the most recent', () => {
    const s = suggest([
      rep({ slug: 'early', lobbyId: 'lobby-a', createdAt: after(1) }),
      rep({ slug: 'late', lobbyId: 'lobby-b', createdAt: after(30), winners: ['p2'] }),
    ]);
    expect(s!.games.map((g) => g.replaySlug)).toEqual(['late']);
    expect(s!.games[0].winner).toBe(e2.id);
  });

  it('replays without a lobbyId are solo groups (never merged)', () => {
    const s = suggest([
      rep({ slug: 'a', lobbyId: null, createdAt: after(1) }),
      rep({ slug: 'b', lobbyId: null, createdAt: after(2), winners: ['p2'] }),
    ]);
    // Two solo groups of 1 → most recent wins.
    expect(s!.games.map((g) => g.replaySlug)).toEqual(['b']);
  });
});
