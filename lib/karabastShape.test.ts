import { describe, it, expect } from 'vitest';
import { validateKarabastGamestate, knownIssueCodes, structuralIssueCodes } from './karabastShape';

// B80: documents the exact karabast gamestate fields our pipeline depends on,
// as stable issue CODES (the drift-beacon wire enum). If karabast drifts, the
// extension/cron report these codes.

const goodSnapshot = () => ({
  id: 'game-1',
  players: {
    p1: { user: { username: 'Alice' }, isActionPhaseActivePlayer: true, leader: { setId: { set: 'SOR', number: 1 } }, base: { setId: { set: 'SOR', number: 2 } }, cardPiles: { hand: [{ id: 'SOR_010', setId: { set: 'SOR', number: 10 } }] } },
    p2: { user: { username: 'Bob' }, isActionPhaseActivePlayer: false, cardPiles: { hand: [{ controllerId: 'p2' }] } },
  },
});

describe('validateKarabastGamestate', () => {
  it('accepts a known-good snapshot', () => {
    expect(validateKarabastGamestate(goodSnapshot())).toEqual({ ok: true, issues: [] });
  });
  it('flags a missing players map / gameId with stable codes', () => {
    expect(validateKarabastGamestate({}).issues).toContain('missing_gameid');
    expect(validateKarabastGamestate({ id: 'g' }).issues).toContain('missing_players');
  });
  it('flags a renamed active-player field', () => {
    const s = goodSnapshot();
    delete (s.players.p1 as any).isActionPhaseActivePlayer;
    delete (s.players.p2 as any).isActionPhaseActivePlayer;
    expect(validateKarabastGamestate(s).issues).toContain('no_active_flag');
  });
  it('flags leader/base that lost setId (card-art drift)', () => {
    const s = goodSnapshot();
    (s.players.p1 as any).leader = { name: 'X' };
    expect(validateKarabastGamestate(s).issues).toContain('leader_no_setid');
  });
  it('dedupes a code even when multiple players trigger it', () => {
    const s = goodSnapshot();
    delete (s.players.p1 as any).user;
    delete (s.players.p2 as any).user;
    expect(validateKarabastGamestate(s).issues.filter((c) => c === 'missing_username')).toHaveLength(1);
  });

  it('every emitted code is in knownIssueCodes (the beacon vocabulary)', () => {
    const known = new Set(knownIssueCodes());
    const r = validateKarabastGamestate({ id: '', players: { p1: { leader: {} } } });
    for (const code of r.issues) expect(known.has(code)).toBe(true);
  });
  it('structuralIssueCodes is a subset of knownIssueCodes and excludes progression-only codes', () => {
    const known = new Set(knownIssueCodes());
    for (const c of structuralIssueCodes()) expect(known.has(c)).toBe(true);
    expect(structuralIssueCodes()).not.toContain('no_visible_hand');
    expect(structuralIssueCodes()).not.toContain('no_active_flag');
  });
});
