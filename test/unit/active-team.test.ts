import { describe, it, expect } from 'vitest';
import { selectActiveTeam, type TeamRef } from '@/lib/activeTeam';

// Phase A — the pure active-team selection rule, lifted out of the cookie/DB
// plumbing so it's testable without next/headers. resolveActiveTeam() reads the
// kb_team cookie + the caller's memberships, then defers the choice to this.
//
// Rule: a valid cookie slug (still a membership) wins; otherwise fall back to
// the first team (ordered by joinedAt upstream); no teams → null.

const A: TeamRef = { slug: 'alpha', name: 'Alpha' };
const B: TeamRef = { slug: 'bravo', name: 'Bravo' };
const teams = [A, B]; // pre-ordered by joinedAt by the caller

describe('selectActiveTeam', () => {
  it('falls back to the first team when no cookie is set', () => {
    expect(selectActiveTeam(teams, null)).toEqual(A);
  });

  it('honors a cookie slug that is still a membership', () => {
    expect(selectActiveTeam(teams, 'bravo')).toEqual(B);
  });

  it('falls back to the first team when the cookie slug is stale / non-member', () => {
    expect(selectActiveTeam(teams, 'charlie')).toEqual(A);
  });

  it('returns null when the caller has no teams (covers anonymous)', () => {
    expect(selectActiveTeam([], null)).toBeNull();
    expect(selectActiveTeam([], 'anything')).toBeNull();
  });
});
