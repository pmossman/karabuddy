import { describe, it, expect } from 'vitest';
import { redactMentionText, redactPublicTags } from './publicTags';

// B133: redaction is what makes "publish my replay's comments" safe — pin the
// alias mapping and every mention-leak path.

const players = [{ username: 'BDST_Squire' }, { username: 'ReprintConfiscate' }];

const tag = (over: Record<string, unknown>) => ({
  id: 't1', replaySlug: 'r_x', frameIndex: 1, comment: 'hi', authorName: 'someone',
  userId: null as string | null, authorToken: 'kb_a', parentTagId: null,
  mentions: null as unknown, createdAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

describe('redactMentionText', () => {
  it('redacts structurally-known multi-word display names', () => {
    expect(redactMentionText('ask @Parker Mossman about it', ['Parker Mossman'], []))
      .toBe('ask @[redacted] about it');
  });

  it('redacts team mentions by name and by slug token', () => {
    expect(redactMentionText('cc @team:k2x8tw and @The Squad', ['The Squad'], ['k2x8tw']))
      .toBe('cc @[redacted] and @[redacted]');
  });

  it('generic sweep catches free-typed @handles with no structural data', () => {
    expect(redactMentionText('yo @luke check this', [], [])).toBe('yo @[redacted] check this');
  });

  it('leaves plain text and emailless prose alone', () => {
    expect(redactMentionText('attack for 6, hold Vader', [], [])).toBe('attack for 6, hold Vader');
  });
});

describe('redactPublicTags', () => {
  it('authors matching a player username get that player’s anon label', () => {
    const rows = [tag({ authorName: 'ReprintConfiscate', authorToken: 'kb_p2' })];
    const out = redactPublicTags(rows, players, { userNamesById: new Map(), teamNamesBySlug: new Map() });
    expect(out[0].authorName).toBe('Player2');
  });

  it('other authors become stable Reviewer N aliases in first-appearance order', () => {
    const rows = [
      tag({ id: 'a', authorName: 'johnw_6', authorToken: 'kb_john', createdAt: '2026-06-01T00:00:00Z' }),
      tag({ id: 'b', authorName: 'anon-gyma', authorToken: 'kb_gyma', createdAt: '2026-06-02T00:00:00Z' }),
      tag({ id: 'c', authorName: 'johnw_6', authorToken: 'kb_john', createdAt: '2026-06-03T00:00:00Z' }),
    ];
    const out = redactPublicTags(rows, players, { userNamesById: new Map(), teamNamesBySlug: new Map() });
    expect(out.map((t) => t.authorName)).toEqual(['Reviewer 1', 'Reviewer 2', 'Reviewer 1']);
  });

  it('strips identity + scope fields and drops structured mentions', () => {
    const rows = [tag({ userId: 'u1', authorToken: 'kb_real', mentions: { userIds: ['u9'], teamSlugs: [] } })];
    const out = redactPublicTags(rows, players, {
      userNamesById: new Map([['u9', 'Luke S']]),
      teamNamesBySlug: new Map(),
    });
    expect(out[0].userId).toBeNull();
    expect(out[0].authorToken).toBe('');
    expect(out[0].mentions).toBeNull();
    expect(out[0].scope).toEqual([]);
  });

  it('redacts the mentioned user’s display name from the comment text', () => {
    const rows = [tag({ comment: 'what would @Luke S do here', mentions: { userIds: ['u9'], teamSlugs: [] } })];
    const out = redactPublicTags(rows, players, {
      userNamesById: new Map([['u9', 'Luke S']]),
      teamNamesBySlug: new Map(),
    });
    expect(out[0].comment).toBe('what would @[redacted] do here');
  });

  it('preserves the input (frame-asc) row order while aliasing by createdAt order', () => {
    const rows = [
      tag({ id: 'late', frameIndex: 2, authorName: 'B', authorToken: 'kb_b', createdAt: '2026-06-02T00:00:00Z' }),
      tag({ id: 'early', frameIndex: 9, authorName: 'A', authorToken: 'kb_a2', createdAt: '2026-06-01T00:00:00Z' }),
    ];
    const out = redactPublicTags(rows, players, { userNamesById: new Map(), teamNamesBySlug: new Map() });
    expect(out.map((t) => t.id)).toEqual(['late', 'early']);
    expect(out.find((t) => t.id === 'early')!.authorName).toBe('Reviewer 1'); // first by createdAt
    expect(out.find((t) => t.id === 'late')!.authorName).toBe('Reviewer 2');
  });
});
