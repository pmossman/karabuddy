import { describe, it, expect } from 'vitest';
import { sanitizeClientMeta } from '@/lib/clientMeta';

// B114: the extension SW attaches recorder metadata to each upload. It's
// untrusted input, so the server whitelists a fixed set of string fields and
// length-caps each.
describe('sanitizeClientMeta', () => {
  it('keeps whitelisted string fields, trimmed', () => {
    expect(sanitizeClientMeta({ extVersion: ' 0.5.12 ', extVersionName: '0.5.12', browser: 'chrome', ua: 'Mozilla/5.0' }))
      .toEqual({ extVersion: '0.5.12', extVersionName: '0.5.12', browser: 'chrome', ua: 'Mozilla/5.0' });
  });

  it('drops unknown keys and non-string values', () => {
    expect(sanitizeClientMeta({ extVersion: '1.0', evil: 'x', count: 5, browser: { nested: true } }))
      .toEqual({ extVersion: '1.0' });
  });

  it('length-caps each field (ua to 256)', () => {
    const out = sanitizeClientMeta({ ua: 'u'.repeat(500), extVersion: 'v'.repeat(100) })!;
    expect(out.ua).toHaveLength(256);
    expect(out.extVersion).toHaveLength(32);
  });

  it('returns null for empty / non-object / array / all-blank input', () => {
    expect(sanitizeClientMeta(null)).toBeNull();
    expect(sanitizeClientMeta('x')).toBeNull();
    expect(sanitizeClientMeta([1, 2])).toBeNull();
    expect(sanitizeClientMeta({})).toBeNull();
    expect(sanitizeClientMeta({ extVersion: '   ', other: 1 })).toBeNull();
  });
});
