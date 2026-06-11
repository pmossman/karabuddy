import { describe, it, expect } from 'vitest';
import { formatRoundMessage, formatFinishedMessage } from '@/lib/tournamentNotify';

// B125: pure Discord message formatters. The senders are best-effort wrappers
// over lib/discord (which no-ops without a bot token — covered by its own
// tests); the formatting is what's worth pinning.

describe('formatRoundMessage', () => {
  it('renders tables with <@id> pings for Discord-linked entrants and bold names otherwise', () => {
    const msg = formatRoundMessage({
      tournamentName: 'Friday Swiss',
      roundNumber: 2,
      url: 'https://karabuddy.app/teams/abc/tournaments/tn_x',
      pairings: [
        { table: 1, entrant1: { name: 'Alice', discordId: '111' }, entrant2: { name: 'Bob', discordId: '222' } },
        { table: 2, entrant1: { name: 'Carol', discordId: null }, entrant2: { name: 'Guest Greg', discordId: null } },
      ],
    });
    expect(msg).toContain('**Friday Swiss** — round 2 is paired');
    expect(msg).toContain('⚔️ Table 1: <@111> vs <@222>');
    expect(msg).toContain('⚔️ Table 2: **Carol** vs **Guest Greg**');
    expect(msg).toContain('https://karabuddy.app/teams/abc/tournaments/tn_x');
  });

  it('renders a bye line instead of a table for the bye entrant', () => {
    const msg = formatRoundMessage({
      tournamentName: 'Cup',
      roundNumber: 1,
      url: 'https://x',
      pairings: [
        { table: 1, entrant1: { name: 'A', discordId: null }, entrant2: { name: 'B', discordId: null } },
        { table: 2, entrant1: { name: 'C', discordId: '333' }, entrant2: null },
      ],
    });
    expect(msg).toContain('🎟️ <@333> has the bye');
    expect(msg).not.toContain('Table 2:');
  });
});

describe('formatFinishedMessage', () => {
  it('renders up to three podium lines with medals + records', () => {
    const msg = formatFinishedMessage({
      tournamentName: 'Season Swiss',
      url: 'https://x',
      podium: [
        { name: 'Alice', record: '3–0' },
        { name: 'Bob', record: '2–1' },
        { name: 'Guest Greg', record: '2–1' },
      ],
    });
    expect(msg).toContain('🏁 **Season Swiss** is finished!');
    expect(msg).toContain('🥇 **Alice** (3–0)');
    expect(msg).toContain('🥈 **Bob** (2–1)');
    expect(msg).toContain('🥉 **Guest Greg** (2–1)');
  });

  it('handles a small field (fewer than 3 entrants)', () => {
    const msg = formatFinishedMessage({ tournamentName: 'Duel', url: 'https://x', podium: [{ name: 'A', record: '1–0' }] });
    expect(msg).toContain('🥇 **A**');
    expect(msg).not.toContain('🥈');
  });
});
