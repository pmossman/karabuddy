import { describe, it, expect } from 'vitest';
import { generateSlug, generateTagId, generateTeamSlug, generateInviteCode } from './slug';

describe('slug', () => {
  it('generateSlug includes prefix and correct alphabet', () => {
    const s = generateSlug('r_', 6);
    expect(s).toMatch(/^r_[23456789abcdefghjkmnpqrstuvwxyz]{6}$/);
  });

  it('generateSlug avoids visually ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const s = generateSlug('x_', 12);
      expect(s).not.toMatch(/[0OIl1]/);
    }
  });

  it('generateTagId yields tag_ + 16 chars', () => {
    expect(generateTagId()).toMatch(/^tag_[23456789abcdefghjkmnpqrstuvwxyz]{16}$/);
  });

  it('generateTeamSlug + generateInviteCode have expected widths', () => {
    expect(generateTeamSlug()).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/);
    expect(generateInviteCode()).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/);
  });

  it('produces unique values across many iterations (no obvious collision)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateSlug('r_', 8));
    expect(seen.size).toBe(1000);
  });
});
