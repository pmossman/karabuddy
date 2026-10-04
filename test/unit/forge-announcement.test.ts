import { describe, expect, it } from 'vitest';
import { isDismissed, requestedMoveTeam, shouldAutoOpen, showMoveSection, type ForgeTeamContext } from '@/app/_components/forgeAnnouncement/rules';
import { FORGE_ANNOUNCEMENT_VERSION, hubMovePath } from '@/app/_components/forgeAnnouncement/constants';

describe('isDismissed', () => {
  it('is dismissed once this version or a newer one was dismissed', () => {
    expect(isDismissed(FORGE_ANNOUNCEMENT_VERSION)).toBe(true);
    expect(isDismissed(FORGE_ANNOUNCEMENT_VERSION + 1)).toBe(true);
  });

  it('still shows when nothing, or only an older version, was dismissed', () => {
    expect(isDismissed(null)).toBe(false);
    expect(isDismissed(FORGE_ANNOUNCEMENT_VERSION - 1)).toBe(false);
  });

  it('shows again when the version is bumped', () => {
    expect(isDismissed(1, 1)).toBe(true);
    expect(isDismissed(1, 2)).toBe(false);
  });
});

describe('shouldAutoOpen', () => {
  const page = { pathname: '/', search: '' };

  it('opens once for a signed-in user who has not dismissed it', () => {
    expect(shouldAutoOpen({ ...page, signedIn: true, dismissed: false })).toBe(true);
    expect(shouldAutoOpen({ ...page, signedIn: true, dismissed: true })).toBe(false);
  });

  it('never opens for signed-out visitors', () => {
    expect(shouldAutoOpen({ ...page, signedIn: false, dismissed: false })).toBe(false);
  });

  it('waits out the replay and clip viewers', () => {
    const fresh = { signedIn: true, dismissed: false, search: '' };
    expect(shouldAutoOpen({ ...fresh, pathname: '/r/abc123' })).toBe(false);
    expect(shouldAutoOpen({ ...fresh, pathname: '/c/abc123' })).toBe(false);
    expect(shouldAutoOpen({ ...fresh, pathname: '/replays' })).toBe(true);
    expect(shouldAutoOpen({ ...fresh, pathname: '/clips' })).toBe(true);
  });

  it('waits out the extension sign-in popup', () => {
    const fresh = { signedIn: true, dismissed: false, pathname: '/' };
    expect(shouldAutoOpen({ ...fresh, search: '?fromExtension=1' })).toBe(false);
    expect(shouldAutoOpen({ ...fresh, search: '?tab=mine' })).toBe(true);
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

describe('the hub deep link to a team move', () => {
  const owner: ForgeTeamContext = { signedIn: true, ownedTeams: [{ slug: 'orgrnd', name: 'Outer Rim' }, { slug: 'tnd001', name: 'Tuesday' }], memberTeamCount: 1, canMove: true };

  it('points at the hub with the team', () => {
    expect(hubMovePath('orgrnd')).toBe('/swu-forge?team=orgrnd');
    expect(hubMovePath('a b&c')).toBe('/swu-forge?team=a%20b%26c');
  });

  it('opens on a team the viewer owns', () => {
    expect(requestedMoveTeam(owner, 'tnd001')).toEqual({ slug: 'tnd001', name: 'Tuesday' });
  });

  it('ignores a team the viewer does not own, a repeated param and no param', () => {
    expect(requestedMoveTeam(owner, 'hyplan')).toBeNull();
    expect(requestedMoveTeam(owner, ['orgrnd', 'tnd001'])).toBeNull();
    expect(requestedMoveTeam(owner, undefined)).toBeNull();
  });

  it('ignores it for members, signed-out visitors and while moves are off', () => {
    expect(requestedMoveTeam({ ...owner, ownedTeams: [] }, 'orgrnd')).toBeNull();
    expect(requestedMoveTeam({ signedIn: false, ownedTeams: [], memberTeamCount: 0, canMove: true }, 'orgrnd')).toBeNull();
    expect(requestedMoveTeam({ ...owner, canMove: false }, 'orgrnd')).toBeNull();
  });
});
