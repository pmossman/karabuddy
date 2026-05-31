// karabuddy.replays.shareStore — bridge-driven share-state I/O.
//
// B79: extracted from 05-footer so the read paths (where the B77 unwrap bug
// lived) are pure + unit-testable with a mock bridge. The bridge's
// companionRequest already unwraps the SW reply to its `.data`, so these read
// fields DIRECTLY off the resolved value — never `resp.data.*`. Each function
// takes the bridge so a test can inject a fake one. (04- so it loads before
// 05-footer; the old 04-playback was removed in B20.)
(() => {
    const NS = ((window.__KaraBuddy ||= {}).replays ||= {});

    const SHARE_KEY = 'karabuddyShareTeamSlugs';
    const SHARE_LAST_KEY = 'karabuddyLastShareTeamSlugs';

    // Local cache (offline fallback). Returns nulls when nothing's stored so
    // the caller can keep its defaults. `res` IS the storage object.
    async function loadLocalArmed(bridge) {
        const res = bridge && bridge.storageGet
            ? await bridge.storageGet([SHARE_KEY, SHARE_LAST_KEY]).catch(() => null)
            : null;
        const cache = res || {};
        return {
            shareTeamSlugs: Array.isArray(cache[SHARE_KEY]) ? cache[SHARE_KEY] : null,
            lastShareTeamSlugs: Array.isArray(cache[SHARE_LAST_KEY]) ? cache[SHARE_LAST_KEY] : null,
        };
    }

    // Server settings (source of truth when signed in). `resp` IS the server
    // body ({ ok, shareTeamSlugs, ... }). Null → not signed in / unavailable →
    // caller keeps the local cache.
    async function loadServerArmed(bridge) {
        const resp = bridge && bridge.getUserSettings
            ? await bridge.getUserSettings().catch(() => null)
            : null;
        if (resp && resp.ok && Array.isArray(resp.shareTeamSlugs)) {
            return { shareTeamSlugs: resp.shareTeamSlugs };
        }
        return null;
    }

    // Write-through: local cache (always) + server (no-op when signed out).
    function persistArmed(bridge, shareTeamSlugs, lastShareTeamSlugs) {
        if (!bridge) return;
        const payload = { [SHARE_KEY]: shareTeamSlugs };
        if (shareTeamSlugs.length > 0) payload[SHARE_LAST_KEY] = lastShareTeamSlugs;
        if (bridge.storageSet) bridge.storageSet(payload);
        if (bridge.setUserSettings) bridge.setUserSettings({ shareTeamSlugs });
    }

    NS.shareStore = { loadLocalArmed, loadServerArmed, persistArmed, SHARE_KEY, SHARE_LAST_KEY };
})();
