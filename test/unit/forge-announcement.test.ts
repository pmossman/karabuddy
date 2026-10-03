import { describe, expect, it } from 'vitest';
import { dismissalKey, shouldAutoOpen, showMoveSection, type ForgeTeamContext } from '@/app/_components/forgeAnnouncement/rules';
import { FORGE_ANNOUNCEMENT_VERSION } from '@/app/_components/forgeAnnouncement/constants';

describe('forge announcement dismissal key', () => {
  it('is versioned and per user', () => {
    expect(dismissalKey('u1')).toBe(`kb:announcement:swu-forge:v${FORGE_ANNOUNCEMENT_VERSION}:u1`);
    expect(dismissalKey('u1')).not.toBe(dismissalKey('u2'));
    expect(dismissalKey('u1', 1)).not.toBe(dismissalKey('u1', 2));
  });
});

describe('shouldAutoOpen', () => {
  it('opens once for a signed-in user who has not dismissed it', () => {
    expect(shouldAutoOpen({ signedIn: true, dismissed: false })).toBe(true);
    expect(shouldAutoOpen({ signedIn: true, dismissed: true })).toBe(false);
  });

  it('never opens for signed-out visitors', () => {
    expect(shouldAutoOpen({ signedIn: false, dismissed: false })).toBe(false);
  });
});

describe('showMoveSection', () => {
  const base: ForgeTeamContext = { signedIn: true, ownedTeams: [], memberTeamCount: 0, canMove: true };

  it('shows for owners and for members', () => {
    expect(showMoveSection({ ...base, ownedTeams: [{ slug: 'a', name: 'A' }] })).toBe(true);
    expect(showMoveSection({ ...base, memberTeamCount: 1 })).toBe(true);
  });

  it('hides for a signed-in user with no teams', () => {
    expect(showMoveSection(base)).toBe(false);
  });

  it('shows the sign-in hint to signed-out visitors', () => {
    expect(showMoveSection({ ...base, signedIn: false })).toBe(true);
  });

  it('hides when team moves are not configured', () => {
    expect(showMoveSection({ ...base, canMove: false, ownedTeams: [{ slug: 'a', name: 'A' }] })).toBe(false);
  });
});
