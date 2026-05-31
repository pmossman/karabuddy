// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// B79: round-trip contract test for the MAIN-world ↔ service-worker bridge.
//
// This is the seam that the B77 persistence bug lived in and that none of our
// other layers cover: the bubble (MAIN world) can't call chrome.* directly, so
// it dispatches `karabast-companion-action` events that content.js relays to
// background.js and answers with `karabast-companion-result`. `companionRequest`
// (in 01-namespace.js) UNWRAPS the SW reply to its `.data` field — so every
// bridge consumer must read fields directly off the resolved value, NOT off a
// `.data` envelope. The bug was a consumer doing `resp.data.x` (always
// undefined): writes worked, reads silently returned empty. These tests pin the
// unwrap contract so that drift fails loudly.

// Load the real 01-namespace.js IIFE into this jsdom window so NS.bridge is the
// actual shipped implementation (companionRequest + the bridge methods).
function loadBridge() {
  const code = readFileSync(path.resolve(__dirname, '01-namespace.js'), 'utf8');
  // eslint-disable-next-line no-eval
  (0, eval)(code);
  return window.__KaraBuddy.replays.bridge;
}

// Stand-in for content.js + background.js: listens for the dispatched action,
// runs a fake SW handler, and answers with content.js's exact result shape
// (`{ _id, type, ok, error, data }`, where data is the SW response's `data`).
function installFakeRelay(swHandler) {
  const onAction = (e) => {
    const { _id, type, ...rest } = e.detail || {};
    Promise.resolve(swHandler(type, rest)).then((res) => {
      window.dispatchEvent(
        new CustomEvent('karabast-companion-result', {
          detail: { _id, type, ok: !!res?.ok, error: res?.error, data: res?.data },
        }),
      );
    });
  };
  window.addEventListener('karabast-companion-action', onAction);
  return () => window.removeEventListener('karabast-companion-action', onAction);
}

let teardown;
afterEach(() => { teardown?.(); teardown = undefined; delete window.__KaraBuddy; });

describe('SW bridge round-trip contract', () => {
  it('storageSet then storageGet round-trips the stored object directly (not wrapped in {ok,data})', async () => {
    const store = {};
    teardown = installFakeRelay((type, msg) => {
      if (type === 'storageSet') { Object.assign(store, msg.items || {}); return { ok: true }; }
      if (type === 'storageGet') {
        const out = {};
        for (const k of msg.keys || []) if (k in store) out[k] = store[k];
        return { ok: true, data: out };
      }
      return { ok: false, error: 'unknown' };
    });
    const bridge = loadBridge();

    await bridge.storageSet({ karabuddyShareTeamSlugs: ['team-a', 'team-b'] });
    const res = await bridge.storageGet(['karabuddyShareTeamSlugs']);

    // The resolved value is the storage object itself — this is exactly what
    // the footer's lsGet consumes. If this regresses to { ok, data: {...} },
    // the footer's `res || {}` read breaks (the original bug).
    expect(res).toEqual({ karabuddyShareTeamSlugs: ['team-a', 'team-b'] });
  });

  it('getUserSettings resolves to the server body directly (fields read off the result)', async () => {
    teardown = installFakeRelay((type) => {
      if (type === 'getUserSettings') {
        // background.js sends { ok, data: body } — companionRequest unwraps to body.
        return { ok: true, data: { ok: true, shareTeamSlugs: ['team-a'], minUploadActions: 7 } };
      }
      return { ok: false };
    });
    const bridge = loadBridge();

    const resp = await bridge.getUserSettings();
    // Consumers read resp.shareTeamSlugs / resp.minUploadActions directly.
    expect(resp.ok).toBe(true);
    expect(resp.shareTeamSlugs).toEqual(['team-a']);
    expect(resp.minUploadActions).toBe(7);
  });

  it('getTeamsMentionData resolves to the body with ok/teams/members (existing convention)', async () => {
    teardown = installFakeRelay((type) => {
      if (type === 'getTeamsMentionData') {
        return { ok: true, data: { ok: true, teams: [{ slug: 't', name: 'T' }], members: [] } };
      }
      return { ok: false };
    });
    const bridge = loadBridge();

    const resp = await bridge.getTeamsMentionData();
    expect(resp.ok).toBe(true);
    expect(resp.teams).toEqual([{ slug: 't', name: 'T' }]);
  });

  it('a non-ok SW reply (e.g. 401) resolves to null for the catch-guarded methods', async () => {
    teardown = installFakeRelay(() => ({ ok: false, error: 'not signed in' }));
    const bridge = loadBridge();

    // getUserSettings/.catch(() => null) → null so consumers fall back to local.
    expect(await bridge.getUserSettings()).toBeNull();
    expect(await bridge.storageGet(['x'])).toBeNull();
  });
});
