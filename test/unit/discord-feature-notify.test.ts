import { describe, it, expect } from 'vitest';
import { formatReviewMessage, formatReviewedByMessage } from '@/lib/reviewNotify';
import {
  formatTournamentCreatedMessage,
  formatRegistrationMessage,
  formatMatchResultMessage,
} from '@/lib/tournamentNotify';

// B144: pure formatters for the new Discord channel posts.

describe('formatReviewMessage', () => {
  it('B149: request added vs request cleared (cleared = cancel, not reviewed)', () => {
    const base = { matchup: 'Boba Fett vs Cad Bane', teamName: 'Squad', actorName: 'Parker', url: 'https://k/r/r1' };
    expect(formatReviewMessage({ ...base, added: true })).toContain('🔍');
    expect(formatReviewMessage({ ...base, added: true })).toContain("added to **Squad**'s review queue by **Parker**");
    expect(formatReviewMessage({ ...base, added: false })).toContain('🗑️');
    expect(formatReviewMessage({ ...base, added: false })).toContain('review request cleared');
  });
});

describe('formatReviewedByMessage', () => {
  it('B149: a member reviewed (the request stays open)', () => {
    const msg = formatReviewedByMessage({ matchup: 'Boba Fett vs Cad Bane', teamName: 'Squad', actorName: 'Ann', url: 'https://k/r/r1' });
    expect(msg).toContain('✅');
    expect(msg).toContain('**Ann** reviewed **Boba Fett vs Cad Bane** in **Squad**');
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

  it('B151: includes deck name + leader/base when present', () => {
    const msg = formatRegistrationMessage({
      tournamentName: 'Cup', entrantName: 'Gus', entrantCount: 2, url: 'u',
      deckName: 'Green Aggro', leaderName: 'Boba Fett', baseName: 'Echo Base',
    });
    expect(msg).toBe('🎟️ **Gus** registered for **Cup** with **Green Aggro** (Boba Fett / Echo Base) (2 entrants) — u');
  });

  it('B151: a deck change uses the updated wording (no entrant count)', () => {
    const msg = formatRegistrationMessage({
      tournamentName: 'Cup', entrantName: 'Gus', entrantCount: 0, url: 'u', updated: true,
      deckName: 'Blue Control', leaderName: 'Thrawn', baseName: null,
    });
    expect(msg).toBe('🔄 **Gus** updated their deck for **Cup** to **Blue Control** (Thrawn) — u');
  });

  it('B151: leader/base alone (no deck name) still renders', () => {
    expect(formatRegistrationMessage({ tournamentName: 'Cup', entrantName: 'Gus', entrantCount: 1, url: 'u', leaderName: 'Boba Fett', baseName: 'Echo Base' }))
      .toBe('🎟️ **Gus** registered for **Cup** with Boba Fett / Echo Base (1 entrant) — u');
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
