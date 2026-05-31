import { describe, it, expect } from 'vitest';
import { canMutateReplay, canEditTag, canDeleteTag, type AuthContext } from './replayPermissions';

// B79: the mutation/edit/delete predicates gate both the server routes and the
// viewer UI, so they're security-relevant — pin every branch.

const ctx = (sessionUserId: string | null, installToken: string | null): AuthContext => ({ sessionUserId, installToken });

describe('canMutateReplay', () => {
  const replay = { userId: 'u1', ownerToken: 'kbx_1' };
  it('true when the session user owns the replay', () => {
    expect(canMutateReplay(replay, ctx('u1', null))).toBe(true);
  });
  it('true when the install token matches the owner token', () => {
    expect(canMutateReplay(replay, ctx(null, 'kbx_1'))).toBe(true);
  });
  it('false for a different user / token', () => {
    expect(canMutateReplay(replay, ctx('u2', 'kbx_2'))).toBe(false);
  });
  it('false for an anonymous caller with no token', () => {
    expect(canMutateReplay(replay, ctx(null, null))).toBe(false);
  });
  it('does not match a null replay.userId against a null session (anonymous replay)', () => {
    expect(canMutateReplay({ userId: null, ownerToken: 'kbx_x' }, ctx(null, null))).toBe(false);
  });
});

describe('canEditTag (author only)', () => {
  const tag = { userId: 'author', authorToken: 'kbx_author' };
  it('true for the tag author by session', () => expect(canEditTag(tag, ctx('author', null))).toBe(true));
  it('true for the tag author by install token', () => expect(canEditTag(tag, ctx(null, 'kbx_author'))).toBe(true));
  it('false for a non-author', () => expect(canEditTag(tag, ctx('other', 'kbx_other'))).toBe(false));
});

describe('canDeleteTag (author OR replay owner)', () => {
  const tag = { userId: 'author', authorToken: 'kbx_author' };
  const replay = { userId: 'owner', ownerToken: 'kbx_owner' };
  it('true for the tag author (not the replay owner)', () => {
    expect(canDeleteTag(tag, replay, ctx('author', null))).toBe(true);
  });
  it('true for the replay owner (not the tag author)', () => {
    expect(canDeleteTag(tag, replay, ctx('owner', null))).toBe(true);
  });
  it('false for someone who is neither — the key authorization boundary', () => {
    expect(canDeleteTag(tag, replay, ctx('stranger', 'kbx_stranger'))).toBe(false);
  });
});
