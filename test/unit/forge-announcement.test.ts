import { describe, expect, it } from 'vitest';
import {
  forgeTeamContext,
  formatMovedOn,
  isDismissed,
  movedTeam,
  requestedMoveTeam,
  shouldAutoOpen,
  showMoveSection,
  type ForgeTeamContext,
} from '@/app/_components/forgeAnnouncement/rules';
import { FORGE_ANNOUNCEMENT_VERSION, hubMovePath } from '@/app/_components/forgeAnnouncement/constants';
import { hubCopy, moveCopy, movedCopy } from '@/app/_components/forgeAnnouncement/copy';
import { forgeTeamLink, type ForgeMigrationPlan } from '@/lib/forgeMigration';

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
  const base: ForgeTeamContext = { signedIn: true, ownedTeams: [], memberTeamCount: 0, movedMemberTeams: [], canMove: true };

  it('shows for owners and for members', () => {
    expect(showMoveSection({ ...base, ownedTeams: [{ slug: 'a', name: 'A', movedOn: null }] })).toBe(true);
    expect(showMoveSection({ ...base, memberTeamCount: 1 })).toBe(true);
  });

  it('hides for a signed-in user with no teams', () => {
    expect(showMoveSection(base)).toBe(false);
  });

  it('shows the sign-in hint to signed-out visitors', () => {
    expect(showMoveSection({ ...base, signedIn: false })).toBe(true);
  });

  it('hides when team moves are not configured', () => {
    expect(showMoveSection({ ...base, canMove: false, ownedTeams: [{ slug: 'a', name: 'A', movedOn: null }] })).toBe(false);
  });
});

describe('the hub deep link to a team move', () => {
  const owner: ForgeTeamContext = {
    signedIn: true,
    ownedTeams: [
      { slug: 'orgrnd', name: 'Outer Rim', movedOn: null },
      { slug: 'tnd001', name: 'Tuesday', movedOn: null },
    ],
    memberTeamCount: 1,
    movedMemberTeams: [],
    canMove: true,
  };

  it('points at the hub with the team', () => {
    expect(hubMovePath('orgrnd')).toBe('/swu-forge?team=orgrnd');
    expect(hubMovePath('a b&c')).toBe('/swu-forge?team=a%20b%26c');
  });

  it('opens on a team the viewer owns', () => {
    expect(requestedMoveTeam(owner, 'tnd001')).toEqual({ slug: 'tnd001', name: 'Tuesday', movedOn: null });
  });

  it('ignores a team the viewer does not own, a repeated param and no param', () => {
    expect(requestedMoveTeam(owner, 'hyplan')).toBeNull();
    expect(requestedMoveTeam(owner, ['orgrnd', 'tnd001'])).toBeNull();
    expect(requestedMoveTeam(owner, undefined)).toBeNull();
  });

  it('ignores it for members, signed-out visitors and while moves are off', () => {
    expect(requestedMoveTeam({ ...owner, ownedTeams: [] }, 'orgrnd')).toBeNull();
    expect(requestedMoveTeam({ signedIn: false, ownedTeams: [], memberTeamCount: 0, movedMemberTeams: [], canMove: true }, 'orgrnd')).toBeNull();
    expect(requestedMoveTeam({ ...owner, canMove: false }, 'orgrnd')).toBeNull();
  });
});

describe('teams that moved to SWU Forge', () => {
  const movedAt = new Date('2026-10-04T18:30:00Z');
  const url = 'https://swuforge.com/teams/ck1';
  const team = (slug: string, role: string, moved = false) => ({
    slug,
    name: slug.toUpperCase(),
    role,
    forgeTeamUrl: moved ? url : null,
    forgeMovedAt: moved ? movedAt : null,
  });

  it('formats the move date the same on every server', () => {
    expect(formatMovedOn(movedAt)).toBe('Oct 4, 2026');
    expect(formatMovedOn(new Date('2026-10-04T23:59:59Z'))).toBe('Oct 4, 2026');
  });

  it('counts a team as moved only once both the URL and the date are recorded', () => {
    expect(movedTeam(team('a', 'member', true))).toEqual({ slug: 'a', name: 'A', url, movedOn: 'Oct 4, 2026' });
    expect(movedTeam(team('a', 'member'))).toBeNull();
    expect(movedTeam({ ...team('a', 'member', true), forgeMovedAt: null })).toBeNull();
    expect(movedTeam({ ...team('a', 'member', true), forgeTeamUrl: null })).toBeNull();
  });

  it('gives owners the move date and members the link, team by team', () => {
    const ctx = forgeTeamContext(true, [team('own1', 'owner', true), team('own2', 'owner'), team('mem1', 'member', true), team('mem2', 'member')], true);
    expect(ctx.ownedTeams).toEqual([
      { slug: 'own1', name: 'OWN1', movedOn: 'Oct 4, 2026' },
      { slug: 'own2', name: 'OWN2', movedOn: null },
    ]);
    expect(ctx.memberTeamCount).toBe(2);
    expect(ctx.movedMemberTeams).toEqual([{ slug: 'mem1', name: 'MEM1', url, movedOn: 'Oct 4, 2026' }]);
  });

  it('has nothing moved for signed-out visitors or users without teams', () => {
    expect(forgeTeamContext(false, [], true)).toEqual({ signedIn: false, ownedTeams: [], memberTeamCount: 0, movedMemberTeams: [], canMove: true });
  });

  it('tells a straggler where to look, and nudges members of teams that have not moved', () => {
    expect(moveCopy.memberMoved('Tuesday Night Draft')).toBe('Tuesday Night Draft has moved to SWU Forge. Look for an invitation from hello@swuforge.com.');
    expect(moveCopy.memberOnly).toMatch(/^Ask your team's owner to move it/);
    expect(hubCopy.move.status.member).toBe("Ask your team's owner to move it.");
    expect(hubCopy.move.status.memberMoved(['TND'])).toBe('TND has moved to SWU Forge.');
    expect(hubCopy.move.status.memberMoved(['A', 'B'])).toBe('2 of your teams have moved to SWU Forge.');
    const guidance = movedCopy.guidance.join(' ');
    expect(guidance).toContain('hello@swuforge.com');
    expect(guidance).toContain('14 days');
    expect(guidance).toContain('same email or Discord account');
    expect(guidance).toContain("team's Members page on SWU Forge");
  });
});

describe('forgeTeamLink', () => {
  const plan = (teamUrl: string | null): ForgeMigrationPlan => ({ outcome: 'created', forgeTeamId: 'ck1', teamUrl, members: [] });

  it('keeps a web URL', () => {
    expect(forgeTeamLink(plan('https://swuforge.com/teams/ck1'))).toBe('https://swuforge.com/teams/ck1');
    expect(forgeTeamLink(plan('http://localhost:5513/teams/ck1'))).toBe('http://localhost:5513/teams/ck1');
  });

  it('drops anything that is not one', () => {
    expect(forgeTeamLink(plan(null))).toBeNull();
    expect(forgeTeamLink(plan('javascript:alert(1)'))).toBeNull();
    expect(forgeTeamLink(plan('/teams/ck1'))).toBeNull();
  });
});
