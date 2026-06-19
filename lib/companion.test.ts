// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  companionCapabilityState, getCompanionInfo, decryptForTeam, loadedTeamKeyIds,
  resolvePrivateReplayAccess, decryptSummary, decryptReplayPayload, hydrateEncryptedTags,
  extensionPresent, rewrapForTeam, rewrapReplay,
} from './companion';

// B170 / ADR 0010: the page-side bridge client. The pure capability mapping is
// unit-tested directly; the RPC is tested against a MOCK bridge that mirrors what
// karabuddy-bridge.js does (listen for companionRequest → reply companionResult).

describe('companionCapabilityState', () => {
  it('no info + not present → absent (no extension at all)', () => {
    expect(companionCapabilityState(null, false)).toBe('absent');
  });
  it('no capability info but extension IS present → unsupported (OLD extension — "update")', () => {
    // The key case: an old build can't answer getCompanionInfo (info null) but
    // DID answer the install-token handshake (present) → it's installed, just old.
    expect(companionCapabilityState(null, true)).toBe('unsupported');
  });
  it('info without the capability → unsupported (too old)', () => {
    expect(companionCapabilityState({ version: '0.5.0', capabilities: [] }, true)).toBe('unsupported');
    expect(companionCapabilityState({ version: '0.5.0', capabilities: ['other'] }, true)).toBe('unsupported');
  });
  it('info with the capability → supported', () => {
    expect(companionCapabilityState({ version: '0.6.0', capabilities: ['privateTeams'] }, true)).toBe('supported');
  });
  it('checks a custom capability name', () => {
    expect(companionCapabilityState({ version: '1', capabilities: ['foo'] }, true, 'foo')).toBe('supported');
  });
});

// A stand-in for karabuddy-bridge.js: replies to companionRequest messages.
function installMockBridge(handler: (request: any) => { ok: boolean; data?: any; error?: string }) {
  const listener = (e: MessageEvent) => {
    const d = e.data;
    if (!d || d.type !== 'karabuddy:companionRequest') return;
    const res = handler(d.request);
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'karabuddy:companionResult', requestId: d.requestId, ...res },
      source: window,
    }));
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

describe('bridge RPC client', () => {
  let teardown: (() => void) | null = null;
  afterEach(() => { teardown?.(); teardown = null; });

  it('getCompanionInfo resolves the SW data when the bridge answers', async () => {
    teardown = installMockBridge((req) =>
      req.type === 'getCompanionInfo'
        ? { ok: true, data: { version: '0.6.0', capabilities: ['privateTeams'] } }
        : { ok: false, error: 'unexpected' });
    const info = await getCompanionInfo();
    expect(info).toEqual({ version: '0.6.0', capabilities: ['privateTeams'] });
    expect(companionCapabilityState(info)).toBe('supported');
  });

  it('getCompanionInfo resolves null when nothing answers (extension absent)', async () => {
    // No bridge installed → the request times out → null.
    const info = await getCompanionInfo(80);
    expect(info).toBeNull();
  });

  it('extensionPresent detects ANY build via the install-token handshake; false when none', async () => {
    // A stand-in for the universal claim-bridge present in every shipped build.
    const listener = (e: MessageEvent) => {
      if (e.data?.type !== 'karabuddy:requestInstallToken') return;
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'karabuddy:installTokenResponse', requestId: e.data.requestId, token: 'kbx_x' },
        source: window,
      }));
    };
    window.addEventListener('message', listener);
    expect(await extensionPresent()).toBe(true);
    window.removeEventListener('message', listener);
    expect(await extensionPresent(80)).toBe(false); // no bridge → timeout → false
  });

  it('decryptForTeam returns the plaintext the SW provides', async () => {
    teardown = installMockBridge((req) =>
      req.type === 'decryptForTeam' && req.teamKeyId === 'kid1'
        ? { ok: true, data: { plaintext: 'decoded summary' } }
        : { ok: false, error: 'no-key' });
    expect(await decryptForTeam('kid1', { v: 1 })).toBe('decoded summary');
  });

  it('decryptForTeam rejects when the SW has no key', async () => {
    teardown = installMockBridge(() => ({ ok: false, error: 'no-key' }));
    await expect(decryptForTeam('kidX', { v: 1 })).rejects.toThrow(/no-key/);
  });

  it('loadedTeamKeyIds returns the kids the SW reports, [] on no bridge', async () => {
    teardown = installMockBridge((req) =>
      req.type === 'listPrivateTeamKeyIds' ? { ok: true, data: ['kid1', 'kid2'] } : { ok: false });
    expect(await loadedTeamKeyIds()).toEqual(['kid1', 'kid2']);
    teardown(); teardown = null;
    expect(await loadedTeamKeyIds()).toEqual([]); // no bridge → timeout → []
  });
});

describe('key rotation (rewrap) bridge helpers', () => {
  let teardown: (() => void) | null = null;
  afterEach(() => { teardown?.(); teardown = null; vi.restoreAllMocks(); });

  it('rewrapForTeam passes old+new kids + envelope to the SW and returns the re-wrapped envelope', async () => {
    let seen: any = null;
    teardown = installMockBridge((req) => {
      if (req.type !== 'rewrapForTeam') return { ok: false, error: 'unexpected' };
      seen = req;
      return { ok: true, data: { envelope: { v: 1, kid: req.newTeamKeyId, wrap: { ct: 'NEW' }, data: { ct: 'SAME' } } } };
    });
    const out: any = await rewrapForTeam('old-kid', 'new-kid', { v: 1, kid: 'old-kid', wrap: { ct: 'OLD' }, data: { ct: 'SAME' } });
    expect(seen.oldTeamKeyId).toBe('old-kid');
    expect(seen.newTeamKeyId).toBe('new-kid');
    expect(out.kid).toBe('new-kid');
  });

  it('rewrapForTeam rejects (no-key) when the SW lacks a key', async () => {
    teardown = installMockBridge(() => ({ ok: false, error: 'no-key' }));
    await expect(rewrapForTeam('o', 'n', { v: 1 })).rejects.toThrow(/no-key/);
  });

  it('rewrapReplay re-wraps the blob payload, the summary, and every encrypted tag', async () => {
    // Blob fetch returns the payload envelope under the OLD kid.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ v: 1, kid: 'old', wrap: { ct: 'P' }, data: { ct: 'PC' } }) }) as any));
    // The SW re-wraps any envelope to the NEW kid.
    teardown = installMockBridge((req) =>
      req.type === 'rewrapForTeam'
        ? { ok: true, data: { envelope: { v: 1, kid: req.newTeamKeyId, wrap: { ct: 'W' }, data: (req.envelope as any).data } } }
        : { ok: false });

    const out = await rewrapReplay('old', 'new', {
      slug: 'r1',
      payloadBlobUrl: 'https://blob/r1.json',
      encryptedSummary: JSON.stringify({ v: 1, kid: 'old', wrap: { ct: 'S' }, data: { ct: 'SC' } }),
      tags: [{ id: 't1', commentEncrypted: JSON.stringify({ v: 1, kid: 'old', wrap: { ct: 'T' }, data: { ct: 'TC' } }) }],
    });

    expect(out.slug).toBe('r1');
    // Every returned envelope is now under the new kid and parses as a string.
    expect(JSON.parse(out.payload).kid).toBe('new');
    expect(JSON.parse(out.encryptedSummary).kid).toBe('new');
    expect(out.tags).toHaveLength(1);
    expect(out.tags[0].id).toBe('t1');
    expect(JSON.parse(out.tags[0].commentEncrypted).kid).toBe('new');
    // The content ciphertext is carried through untouched (rewrap, not re-encrypt).
    expect(JSON.parse(out.payload).data.ct).toBe('PC');
  });

  it('rewrapReplay tolerates a null encryptedSummary (empty string out)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ v: 1, kid: 'old', wrap: {}, data: {} }) }) as any));
    teardown = installMockBridge((req) =>
      req.type === 'rewrapForTeam' ? { ok: true, data: { envelope: { v: 1, kid: 'new', wrap: {}, data: {} } } } : { ok: false });
    const out = await rewrapReplay('old', 'new', { slug: 'r2', payloadBlobUrl: 'https://b/r2.json', encryptedSummary: null, tags: [] });
    expect(out.encryptedSummary).toBe('');
  });
});

describe('resolvePrivateReplayAccess', () => {
  const sup = { version: '0.6.0', capabilities: ['privateTeams'] };
  it('non-encrypted replay → plaintext regardless of extension', () => {
    expect(resolvePrivateReplayAccess({ encrypted: false, teamKeyId: null, companion: null, loadedKeyIds: [] })).toBe('plaintext');
  });
  it('encrypted + no extension (not present) → absent', () => {
    expect(resolvePrivateReplayAccess({ encrypted: true, teamKeyId: 'kid1', companion: null, present: false, loadedKeyIds: [] })).toBe('absent');
  });
  it('encrypted + OLD extension (present, no capability handshake) → unsupported', () => {
    expect(resolvePrivateReplayAccess({ encrypted: true, teamKeyId: 'kid1', companion: null, present: true, loadedKeyIds: [] })).toBe('unsupported');
  });
  it('encrypted + supported but key not loaded → needs-key', () => {
    expect(resolvePrivateReplayAccess({ encrypted: true, teamKeyId: 'kid1', companion: sup, loadedKeyIds: ['other'] })).toBe('needs-key');
  });
  it('encrypted + supported + key loaded → ready', () => {
    expect(resolvePrivateReplayAccess({ encrypted: true, teamKeyId: 'kid1', companion: sup, loadedKeyIds: ['kid1'] })).toBe('ready');
  });
});

describe('decrypt helpers', () => {
  let teardown: (() => void) | null = null;
  afterEach(() => { teardown?.(); teardown = null; vi.restoreAllMocks(); });

  it('decryptSummary parses the envelope, decrypts, and JSON-parses the plaintext', async () => {
    const summaryObj = { v: 1, players: { p1: { username: 'Alice' } }, winners: ['Alice'] };
    teardown = installMockBridge((req) =>
      req.type === 'decryptForTeam' ? { ok: true, data: { plaintext: JSON.stringify(summaryObj) } } : { ok: false });
    const encryptedSummary = JSON.stringify({ v: 1, alg: 'A256GCM', kid: 'kid1', wrap: {}, data: {} });
    expect(await decryptSummary('kid1', encryptedSummary)).toEqual(summaryObj);
  });

  it('decryptReplayPayload fetches the blob, decrypts, and returns the payload object', async () => {
    const payloadObj = { version: 2, events: [], localPlayerId: 'p1' };
    const envelope = { v: 1, alg: 'A256GCM', kid: 'kid1', wrap: {}, data: {} };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => envelope }) as any));
    teardown = installMockBridge((req) =>
      req.type === 'decryptForTeam' ? { ok: true, data: { plaintext: JSON.stringify(payloadObj) } } : { ok: false });
    expect(await decryptReplayPayload('kid1', 'https://blob/enc.json')).toEqual(payloadObj);
  });

  it('hydrateEncryptedTags decrypts commentEncrypted → comment, passes others through, placeholders failures', async () => {
    teardown = installMockBridge((req) =>
      req.type === 'decryptForTeam' && req.envelope?.id === 'ok'
        ? { ok: true, data: { plaintext: 'decoded comment' } }
        : { ok: false, error: 'no-key' });
    const tags = [
      { id: 'a', comment: '', commentEncrypted: JSON.stringify({ id: 'ok' }) }, // decrypts
      { id: 'b', comment: 'plain', commentEncrypted: null },                    // passthrough
      { id: 'c', comment: '', commentEncrypted: JSON.stringify({ id: 'bad' }) }, // fails → placeholder
    ];
    const out = await hydrateEncryptedTags(tags, 'kid1');
    expect(out[0].comment).toBe('decoded comment');
    expect(out[1].comment).toBe('plain');
    expect(out[2].comment).toMatch(/encrypted/i);
  });
});
