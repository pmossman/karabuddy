// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// B170 / ADR 0010: prove the byte-identical extension copy of the crypto module
// loads as a MAIN-world classic script (where `module` is undefined) and
// attaches to window.__KaraBuddy.replays.e2ee — the dual-mode export path the
// extension actually uses. WebCrypto comes from Node's globalThis.crypto, which
// the module reads even under jsdom. Same eval-into-jsdom pattern as
// decoder.test.js / bridge.test.js.
function loadE2ee() {
  const code = readFileSync(path.resolve(__dirname, '00-e2ee.js'), 'utf8');
  // eslint-disable-next-line no-eval
  (0, eval)(code);
  return window.__KaraBuddy.replays.e2ee;
}

let e2ee;
beforeEach(() => { e2ee = loadE2ee(); });
afterEach(() => { delete window.__KaraBuddy; });

describe('e2ee — extension classic-script export', () => {
  it('exposes the API on the MAIN-world namespace (no CommonJS in the page)', () => {
    expect(typeof e2ee.generateTeamKey).toBe('function');
    expect(typeof e2ee.encryptContent).toBe('function');
    expect(typeof e2ee.decryptContent).toBe('function');
    expect(typeof e2ee.teamKeyId).toBe('function');
    expect(typeof e2ee.rewrapKey).toBe('function');
  });

  it('roundtrips through the extension copy', async () => {
    const { key } = await e2ee.generateTeamKey();
    const env = await e2ee.encryptContent(key, JSON.stringify({ leaders: ['Vader'] }));
    expect(JSON.stringify(env)).not.toContain('Vader');
    expect(await e2ee.decryptContent(key, env)).toBe(JSON.stringify({ leaders: ['Vader'] }));
  });
});
