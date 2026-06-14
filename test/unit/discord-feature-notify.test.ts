import { describe, it, expect } from 'vitest';
import { formatReviewMessage } from '@/lib/reviewNotify';
import {
  formatTournamentCreatedMessage,
  formatRegistrationMessage,
  formatMatchResultMessage,
} from '@/lib/tournamentNotify';

// B144: pure formatters for the new Discord channel posts.

describe('formatReviewMessage', () => {
  it('added vs cleared', () => {
    const base = { matchup: 'Boba Fett vs Cad Bane', teamName: 'Squad', actorName: 'Parker', url: 'https://k/r/r1' };
    expect(formatReviewMessage({ ...base, added: true })).toContain('🔍');
    expect(formatReviewMessage({ ...base, added: true })).toContain("added to **Squad**'s review queue by **Parker**");
    expect(formatReviewMessage({ ...base, added: false })).toContain('✅');
    expect(formatReviewMessage({ ...base, added: false })).toContain('marked reviewed');
  });
});

describe('formatTournamentCreatedMessage', () => {
  it('with and without a creator name', () => {
    expect(formatTournamentCreatedMessage({ tournamentName: 'Cup', createdBy: 'Parker', url: 'u' }))
      .toBe('🆕 New tournament **Cup** created by **Parker** — register: u');
    expect(formatTournamentCreatedMessage({ tournamentName: 'Cup', createdBy: null, url: 'u' }))
      .toBe('🆕 New tournament **Cup** created — register: u');
  });
});

describe('formatRegistrationMessage', () => {
  it('singular vs plural entrant count', () => {
    expect(formatRegistrationMessage({ tournamentName: 'Cup', entrantName: 'Gus', entrantCount: 1, url: 'u' }))
      .toBe('🎟️ **Gus** registered for **Cup** (1 entrant) — u');
    expect(formatRegistrationMessage({ tournamentName: 'Cup', entrantName: 'Gus', entrantCount: 3, url: 'u' }))
      .toContain('(3 entrants)');
  });
});

describe('formatMatchResultMessage', () => {
  const base = { tournamentName: 'Cup', roundNumber: 2, table: 1, entrant1: 'Alice', entrant2: 'Bob', url: 'u' };
  it('decisive result names the winner', () => {
    const msg = formatMatchResultMessage({ ...base, e1Wins: 2, e2Wins: 0, pending: false });
    expect(msg).toContain('**Alice** def. **Bob** 2–0');
    expect(msg).not.toContain('awaiting');
  });
  it('orders winner first when entrant2 wins', () => {
    expect(formatMatchResultMessage({ ...base, e1Wins: 1, e2Wins: 2, pending: false })).toContain('**Bob** def. **Alice** 2–1');
  });
  it('draw + pending', () => {
    const msg = formatMatchResultMessage({ ...base, e1Wins: 1, e2Wins: 1, pending: true });
    expect(msg).toContain('(draw)');
    expect(msg).toContain('awaiting organizer');
  });
});
