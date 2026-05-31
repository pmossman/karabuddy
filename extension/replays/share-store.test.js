// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// B79: unit tests for the share-state reads/writes (NS.shareStore). These are
// the exact consumers that the B77 unwrap bug broke. The fake bridge returns
// the SAME shapes companionRequest resolves to (storageGet → the storage
// object; getUserSettings → the server body). A consumer that re-unwraps
// (`resp.data.shareTeamSlugs`) gets undefined here and fails the test.

function loadShareStore() {
  const code = readFileSync(path.resolve(__dirname, '04-share-store.js'), 'utf8');
  // eslint-disable-next-line no-eval
  (0, eval)(code);
  return window.__KaraBuddy.replays.shareStore;
}

let shareStore;
beforeEach(() => { shareStore = loadShareStore(); });
afterEach(() => { delete window.__KaraBuddy; });

describe('shareStore.loadLocalArmed', () => {
  it('reads the armed teams straight off the resolved storage object', async () => {
    const bridge = {
      storageGet: vi.fn().mockResolvedValue({
        karabuddyShareTeamSlugs: ['team-a', 'team-b'],
        karabuddyLastShareTeamSlugs: ['team-a'],
      }),
    };
    const r = await shareStore.loadLocalArmed(bridge);
    expect(bridge.storageGet).toHaveBeenCalledWith(['karabuddyShareTeamSlugs', 'karabuddyLastShareTeamSlugs']);
    expect(r.shareTeamSlugs).toEqual(['team-a', 'team-b']);
    expect(r.lastShareTeamSlugs).toEqual(['team-a']);
  });

  it('returns nulls when the cache is empty or the bridge fails', async () => {
    expect(await shareStore.loadLocalArmed({ storageGet: vi.fn().mockResolvedValue({}) })).toEqual({ shareTeamSlugs: null, lastShareTeamSlugs: null });
    expect(await shareStore.loadLocalArmed({ storageGet: vi.fn().mockRejectedValue(new Error('x')) })).toEqual({ shareTeamSlugs: null, lastShareTeamSlugs: null });
    expect(await shareStore.loadLocalArmed(null)).toEqual({ shareTeamSlugs: null, lastShareTeamSlugs: null });
  });
});

describe('shareStore.loadServerArmed', () => {
  it('reads shareTeamSlugs directly off the server body (the bug was reading .data)', async () => {
    const bridge = { getUserSettings: vi.fn().mockResolvedValue({ ok: true, shareTeamSlugs: ['team-x'], minUploadActions: 5 }) };
    expect(await shareStore.loadServerArmed(bridge)).toEqual({ shareTeamSlugs: ['team-x'] });
  });

  it('returns null when signed out / unavailable so the caller keeps local', async () => {
    expect(await shareStore.loadServerArmed({ getUserSettings: vi.fn().mockResolvedValue(null) })).toBeNull();
    expect(await shareStore.loadServerArmed({ getUserSettings: vi.fn().mockResolvedValue({ ok: false }) })).toBeNull();
    expect(await shareStore.loadServerArmed(null)).toBeNull();
  });
});

describe('shareStore.persistArmed', () => {
  it('writes the local cache and mirrors to the server', () => {
    const bridge = { storageSet: vi.fn(), setUserSettings: vi.fn() };
    shareStore.persistArmed(bridge, ['team-a', 'team-b'], ['team-a', 'team-b']);
    expect(bridge.storageSet).toHaveBeenCalledWith({
      karabuddyShareTeamSlugs: ['team-a', 'team-b'],
      karabuddyLastShareTeamSlugs: ['team-a', 'team-b'],
    });
    expect(bridge.setUserSettings).toHaveBeenCalledWith({ shareTeamSlugs: ['team-a', 'team-b'] });
  });

  it('does not persist a lastShareTeamSlugs key when disarming (empty selection)', () => {
    const bridge = { storageSet: vi.fn(), setUserSettings: vi.fn() };
    shareStore.persistArmed(bridge, [], ['team-a']);
    expect(bridge.storageSet).toHaveBeenCalledWith({ karabuddyShareTeamSlugs: [] });
    expect(bridge.setUserSettings).toHaveBeenCalledWith({ shareTeamSlugs: [] });
  });
});
