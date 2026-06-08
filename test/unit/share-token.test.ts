import { describe, expect, it, beforeAll } from 'vitest';
import { signMoment, verifyMoment } from '@/lib/shareToken';

beforeAll(() => { process.env.AUTH_SECRET ||= 'test-secret'; });

const claim = { slug: 'r_abc123', frameIndex: 52, tagId: 'tag_xyz' };

describe('shareToken', () => {
  it('round-trips a claim', () => {
    expect(verifyMoment(signMoment(claim))).toEqual(claim);
  });

  it('rejects a tampered payload', () => {
    const t = signMoment(claim);
    const [p, sig] = t.split('.');
    // flip a payload char (keep it valid base64url)
    const bad = (p[0] === 'A' ? 'B' : 'A') + p.slice(1);
    expect(verifyMoment(`${bad}.${sig}`)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const t = signMoment(claim);
    const [p, sig] = t.split('.');
    const bad = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(verifyMoment(`${p}.${bad}`)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const t = signMoment(claim);
    const prev = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = 'a-different-secret';
    try {
      expect(verifyMoment(t)).toBeNull();
    } finally {
      process.env.AUTH_SECRET = prev;
    }
  });

  it('returns null for garbage / empty input', () => {
    for (const bad of [null, undefined, '', 'nope', 'a.b.c', 'onlyonepart']) {
      expect(verifyMoment(bad as any)).toBeNull();
    }
  });

  it('preserves frame 0 (no truthiness bug)', () => {
    expect(verifyMoment(signMoment({ slug: 's', frameIndex: 0, tagId: 'g' }))).toEqual({ slug: 's', frameIndex: 0, tagId: 'g' });
  });
});
