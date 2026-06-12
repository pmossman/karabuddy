import { describe, it, expect } from 'vitest';
import { isReplayOwnerViewer, tagVisibleToViewer } from './tagScope';

// B79: tagVisibleToViewer is the pure read-side half of the B71 comment-scoping
// security boundary (the DB-backed resolve/backfill are covered in
// test/api/backfill-tag-scope.test.ts). A regression here leaks comments across
// teams, so pin every visibility branch.

const viewer = (userId: string | null, installToken: string | null, teams: string[]) => ({
  userId,
  installToken,
  teams: new Set(teams),
});

describe('tagVisibleToViewer', () => {
  it('the author always sees their own tag (by account)', () => {
    expect(tagVisibleToViewer({ userId: 'me', authorToken: 'kbx_me' }, new Set(), viewer('me', null, []))).toBe(true);
  });

  it('the anonymous author sees their own tag (by install token)', () => {
    expect(tagVisibleToViewer({ userId: null, authorToken: 'kbx_me' }, new Set(), viewer(null, 'kbx_me', []))).toBe(true);
  });

  it('a personal tag (empty scope) is hidden from everyone but the author', () => {
    expect(tagVisibleToViewer({ userId: 'them', authorToken: 'kbx_them' }, new Set(), viewer('me', 'kbx_me', ['team-a']))).toBe(false);
  });

  it('a team-scoped tag is visible to a member of that team', () => {
    expect(tagVisibleToViewer({ userId: 'them', authorToken: 'kbx_them' }, new Set(['team-a']), viewer('me', null, ['team-a']))).toBe(true);
  });

  it('a team-scoped tag is hidden from a non-member (the cross-team leak guard)', () => {
    expect(tagVisibleToViewer({ userId: 'them', authorToken: 'kbx_them' }, new Set(['team-a']), viewer('me', null, ['team-b']))).toBe(false);
  });

  it('visible if the viewer is in ANY of the scoped teams', () => {
    expect(tagVisibleToViewer({ userId: 'them', authorToken: 'kbx_them' }, new Set(['team-a', 'team-b']), viewer('me', null, ['team-b']))).toBe(true);
  });

  // B131: the replay owner sees every tag on their own replay — including an
  // anonymous visitor's personal-scoped feedback.
  it('the replay owner sees a stranger’s personal tag on their replay', () => {
    expect(tagVisibleToViewer({ userId: null, authorToken: 'kbx_friend' }, new Set(), { ...viewer('me', null, []), isReplayOwner: true })).toBe(true);
  });

  it('owner visibility also covers other teams’ scoped tags on their replay', () => {
    expect(tagVisibleToViewer({ userId: 'them', authorToken: 'kbx_them' }, new Set(['team-x']), { ...viewer('me', null, []), isReplayOwner: true })).toBe(true);
  });

  it('a non-owner without isReplayOwner stays excluded (default false)', () => {
    expect(tagVisibleToViewer({ userId: null, authorToken: 'kbx_friend' }, new Set(), viewer('me', null, []))).toBe(false);
  });
});

describe('isReplayOwnerViewer', () => {
  it('matches by claimed account', () => {
    expect(isReplayOwnerViewer({ userId: 'me', ownerToken: 'kbx_owner' }, { userId: 'me', installToken: null })).toBe(true);
  });

  it('matches an anonymous owner by install token', () => {
    expect(isReplayOwnerViewer({ userId: null, ownerToken: 'kbx_owner' }, { userId: null, installToken: 'kbx_owner' })).toBe(true);
  });

  it('a stranger is not the owner', () => {
    expect(isReplayOwnerViewer({ userId: 'me', ownerToken: 'kbx_owner' }, { userId: 'them', installToken: 'kbx_them' })).toBe(false);
  });

  it('null fields never match null viewer context', () => {
    expect(isReplayOwnerViewer({ userId: null, ownerToken: null }, { userId: null, installToken: null })).toBe(false);
  });
});
