import { describe, expect, it } from 'vitest';
import * as e2ee from './e2ee.js';

// B170 / ADR 0010 — the isolated crypto module is THE trusted artifact. These
// tests pin the security-critical invariants: envelope roundtrip, key-never-
// leaks, wrong/tampered/rotated key fails closed, non-deterministic nonces,
// deterministic non-invertible key id. WebCrypto (AES-256-GCM + HKDF), no deps.

describe('e2ee — team key + id', () => {
  it('generateTeamKey returns a base64url 256-bit key + a derived id', async () => {
    const { key, teamKeyId } = await e2ee.generateTeamKey();
    expect(typeof key).toBe('string');
    // 32 random bytes → 43 base64url chars (no padding)
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(typeof teamKeyId).toBe('string');
    expect(teamKeyId.length).toBeGreaterThan(0);
    expect(teamKeyId).toBe(await e2ee.teamKeyId(key));
  });

  it('teamKeyId is deterministic per key and differs across keys', async () => {
    const a = await e2ee.generateTeamKey();
    const b = await e2ee.generateTeamKey();
    expect(await e2ee.teamKeyId(a.key)).toBe(a.teamKeyId);
    expect(a.teamKeyId).not.toBe(b.teamKeyId);
  });

  it('teamKeyId is non-invertible — short, fixed-length, not the key', async () => {
    const { key, teamKeyId } = await e2ee.generateTeamKey();
    expect(teamKeyId).not.toContain(key);
    expect(key).not.toContain(teamKeyId);
    // 8 bytes → 11 base64url chars
    expect(teamKeyId).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });
});

describe('e2ee — encrypt / decrypt roundtrip', () => {
  it('roundtrips plaintext', async () => {
    const { key } = await e2ee.generateTeamKey();
    const env = await e2ee.encryptContent(key, 'hello karabuddy');
    expect(await e2ee.decryptContent(key, env)).toBe('hello karabuddy');
  });

  it('roundtrips JSON + unicode + empty string', async () => {
    const { key } = await e2ee.generateTeamKey();
    for (const pt of [JSON.stringify({ leaders: ['Vader'], 名: '✦' }), '✦🜲 émoji', '']) {
      const env = await e2ee.encryptContent(key, pt);
      expect(await e2ee.decryptContent(key, env)).toBe(pt);
    }
  });

  it('envelope is well-formed, kid matches the key, and leaks no plaintext/key', async () => {
    const { key, teamKeyId } = await e2ee.generateTeamKey();
    const env = await e2ee.encryptContent(key, 'TopSecretLine');
    expect(env.v).toBe(1);
    expect(env.alg).toBe('A256GCM');
    expect(env.kid).toBe(teamKeyId);
    const serialized = JSON.stringify(env);
    expect(serialized).not.toContain('TopSecretLine');
    expect(serialized).not.toContain(key);
  });

  it('is non-deterministic — same plaintext + key → different ciphertext', async () => {
    const { key } = await e2ee.generateTeamKey();
    const a = await e2ee.encryptContent(key, 'same');
    const b = await e2ee.encryptContent(key, 'same');
    expect(a.data.ct).not.toBe(b.data.ct);
    expect(a.data.iv).not.toBe(b.data.iv);
    expect(a.wrap.ct).not.toBe(b.wrap.ct); // fresh per-content data key each time
  });
});

describe('e2ee — fails closed', () => {
  it('rejects decryption with the wrong key (kid mismatch)', async () => {
    const a = await e2ee.generateTeamKey();
    const b = await e2ee.generateTeamKey();
    const env = await e2ee.encryptContent(a.key, 'secret');
    await expect(e2ee.decryptContent(b.key, env)).rejects.toThrow();
  });

  it('rejects a tampered ciphertext (GCM auth tag)', async () => {
    const { key } = await e2ee.generateTeamKey();
    const env = await e2ee.encryptContent(key, 'secret');
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    await expect(e2ee.decryptContent(key, { ...env, data: { ...env.data, ct: flip(env.data.ct) } })).rejects.toThrow();
  });

  it('rejects a tampered wrapped key', async () => {
    const { key } = await e2ee.generateTeamKey();
    const env = await e2ee.encryptContent(key, 'secret');
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    await expect(e2ee.decryptContent(key, { ...env, wrap: { ...env.wrap, ct: flip(env.wrap.ct) } })).rejects.toThrow();
  });
});

describe('e2ee — forward-only rotation (rewrap, no re-encrypt)', () => {
  it('rewraps the data key to a new team key without touching the content ciphertext', async () => {
    const oldK = await e2ee.generateTeamKey();
    const newK = await e2ee.generateTeamKey();
    const env = await e2ee.encryptContent(oldK.key, 'rotate me');
    const rewrapped = await e2ee.rewrapKey(oldK.key, newK.key, env);

    // content ciphertext is untouched — only the wrap + kid change
    expect(rewrapped.data.ct).toBe(env.data.ct);
    expect(rewrapped.data.iv).toBe(env.data.iv);
    expect(rewrapped.kid).toBe(newK.teamKeyId);
    expect(rewrapped.wrap.ct).not.toBe(env.wrap.ct);

    // new key decrypts; old key no longer does
    expect(await e2ee.decryptContent(newK.key, rewrapped)).toBe('rotate me');
    await expect(e2ee.decryptContent(oldK.key, rewrapped)).rejects.toThrow();
  });
});
