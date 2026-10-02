import { describe, expect, it } from 'vitest';
import { dismissalKey, shouldAutoOpen, showMoveSection, type ForgeTeamContext } from '@/app/_components/forgeAnnouncement/rules';
import { FORGE_ANNOUNCEMENT_VERSION, FULL_NOTE_PATH } from '@/app/_components/forgeAnnouncement/constants';

describe('forge announcement dismissal key', () => {
  it('is versioned and per user', () => {
    expect(dismissalKey('u1')).toBe(`kb:announcement:swu-forge:v${FORGE_ANNOUNCEMENT_VERSION}:u1`);
    expect(dismissalKey('u1')).not.toBe(dismissalKey('u2'));
    expect(dismissalKey('u1', 1)).not.toBe(dismissalKey('u1', 2));
  });
});

describe('shouldAutoOpen', () => {
  it('opens once for a signed-in user who has not dismissed it', () => {
    expect(shouldAutoOpen({ signedIn: true, pathname: '/teams/abc', dismissed: false })).toBe(true);
    expect(shouldAutoOpen({ signedIn: true, pathname: '/teams/abc', dismissed: true })).toBe(false);
  });

  it('never opens for signed-out visitors or on the full note page', () => {
    expect(shouldAutoOpen({ signedIn: false, pathname: '/', dismissed: false })).toBe(false);
    expect(shouldAutoOpen({ signedIn: true, pathname: FULL_NOTE_PATH, dismissed: false })).toBe(false);
  });
});

describe('showMoveSection', () => {
  const base: ForgeTeamContext = { signedIn: true, ownedTeams: [], memberTeamCount: 0, canMove: true };

  it('shows for owners and for members', () => {
    expect(showMoveSection('modal', { ...base, ownedTeams: [{ slug: 'a', name: 'A' }] })).toBe(true);
    expect(showMoveSection('modal', { ...base, memberTeamCount: 1 })).toBe(true);
  });

  it('hides for a signed-in user with no teams', () => {
    expect(showMoveSection('modal', base)).toBe(false);
    expect(showMoveSection('page', base)).toBe(false);
  });

  it('shows the sign-in hint to signed-out visitors', () => {
    expect(showMoveSection('page', { ...base, signedIn: false })).toBe(true);
    expect(showMoveSection('modal', { ...base, signedIn: false })).toBe(true);
  });

  it('hides everywhere when team moves are not configured', () => {
    expect(showMoveSection('page', { ...base, canMove: false, ownedTeams: [{ slug: 'a', name: 'A' }] })).toBe(false);
  });
});
