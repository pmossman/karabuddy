import { describe, expect, it } from 'vitest';
// Import the shared plain-JS module exactly as the web app does. The
// extension consumes a verbatim copy of the same file, so these vectors
// guard BOTH surfaces against drift.
import { scopeFromMentions, scopeLabel } from './commentScope';

const memberTeams = {
  alice: ['vanguard'],
  bob: ['locals'],
  carol: ['vanguard', 'locals'], // in two teams
  dave: ['worlds'], // a team that may not be armed
};
const armed = ['vanguard', 'locals', 'worlds'];

describe('scopeFromMentions', () => {
  it('0 mentions → all armed teams (broadcast)', () => {
    expect(scopeFromMentions({ armedTeams: armed, mentionedUserIds: [], memberTeams })).toEqual(armed);
  });

  it('one mention → that person\'s team only', () => {
    expect(scopeFromMentions({ armedTeams: armed, mentionedUserIds: ['alice'], memberTeams })).toEqual(['vanguard']);
  });

  it('two mentions → union of their teams (Parker\'s @alice @bob case)', () => {
    expect(scopeFromMentions({ armedTeams: armed, mentionedUserIds: ['alice', 'bob'], memberTeams })).toEqual(['vanguard', 'locals']);
  });

  it('a mentioned person in two teams contributes both', () => {
    expect(scopeFromMentions({ armedTeams: armed, mentionedUserIds: ['carol'], memberTeams })).toEqual(['vanguard', 'locals']);
  });

  it('result follows armed order, not mention order', () => {
    expect(scopeFromMentions({ armedTeams: armed, mentionedUserIds: ['bob', 'alice'], memberTeams })).toEqual(['vanguard', 'locals']);
  });

  it('never scopes past the armed set (mentioned team not armed is dropped)', () => {
    expect(scopeFromMentions({ armedTeams: ['vanguard', 'locals'], mentionedUserIds: ['dave'], memberTeams })).toEqual([]);
  });

  it('no teams armed → personal regardless of mentions', () => {
    expect(scopeFromMentions({ armedTeams: [], mentionedUserIds: ['alice'], memberTeams })).toEqual([]);
  });

  it('tolerates missing/empty input', () => {
    expect(scopeFromMentions({})).toEqual([]);
    expect(scopeFromMentions({ armedTeams: ['vanguard'] })).toEqual(['vanguard']);
  });
});

describe('scopeLabel', () => {
  const names = { vanguard: 'Vanguard', locals: 'Locals', worlds: 'Worlds Prep' };
  it('empty scope → Just me', () => {
    expect(scopeLabel([], armed, names)).toBe('Just me');
  });
  it('full armed set → All N teams', () => {
    expect(scopeLabel(armed, armed, names)).toBe('All 3 teams');
  });
  it('single team (of several armed) → "<name> only"', () => {
    expect(scopeLabel(['vanguard'], armed, names)).toBe('Vanguard only');
  });
  it('subset → comma-joined names', () => {
    expect(scopeLabel(['vanguard', 'locals'], armed, names)).toBe('Vanguard, Locals');
  });
  it('only one team armed → just the name (no "All 1 team", no "only")', () => {
    expect(scopeLabel(['vanguard'], ['vanguard'], names)).toBe('Vanguard');
  });
});
