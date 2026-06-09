// karabuddy.replays — namespace + URL flags + service-worker bridge.
//
// The replays modules run in karabast.net's MAIN world. They can't use ES
// imports without bundling, so each file IIFEs and attaches to a single
// shared namespace on window. Subsequent files read each other's exports
// lazily (NS.X.method()), so cross-file order only matters for top-level
// side effects (which we keep in the latest-loading file that owns them).
(() => {
    const NS = ((window.__KaraBuddy ||= {}).replays ||= {});

    const params = new URLSearchParams(location.search);
    NS.flags = {
        SOLO_SIDE: params.get('extSide'),
        SOLO_MODE: !!params.get('extSide')
    };

    // ---------- Debug logging (off by default) ----------
    // Enable via either:
    //   - localStorage.karabuddyDebug = '1'  (persists across reloads)
    //   - window.__KaraBuddy.debug = true    (runtime toggle, no reload)
    // dlog() is a no-op unless one is set. Use it for low-level trace lines
    // (XHR intercepts, socket handshakes, dispatch attempts) so they're
    // always wired but only surface when you ask. Keep important lifecycle
    // events as plain console.log so they're always visible.
    const isDebugEnabled = () => {
        if (window.__KaraBuddy?.debug) return true;
        try { return localStorage.getItem('karabuddyDebug') === '1'; } catch { return false; }
    };
    NS.dlog = (...args) => { if (isDebugEnabled()) console.log(...args); };
    NS.dwarn = (...args) => { if (isDebugEnabled()) console.warn(...args); };

    // ---------- Service-worker bridge ----------
    // Storage and tab orchestration live in background.js (extension origin)
    // so the replays browser page can talk to the same store. We dispatch
    // karabast-companion-action events with a correlation id, content.js
    // forwards them via chrome.runtime.sendMessage, and the reply comes back
    // as karabast-companion-result with the same id.
    let nextCompanionId = 0;
    const companionRequest = (action, timeoutMs = 5000) =>
        new Promise((resolve, reject) => {
            const id = ++nextCompanionId;
            const handler = (e) => {
                if (e.detail?._id !== id) return;
                window.removeEventListener('karabast-companion-result', handler);
                clearTimeout(timer);
                if (e.detail.ok) resolve(e.detail.data);
                else reject(new Error(e.detail.error || `request failed: ${action.type}`));
            };
            window.addEventListener('karabast-companion-result', handler);
            const timer = setTimeout(() => {
                window.removeEventListener('karabast-companion-result', handler);
                reject(new Error(`request timed out: ${action.type}`));
            }, timeoutMs);
            window.dispatchEvent(new CustomEvent('karabast-companion-action', {
                detail: { _id: id, ...action }
            }));
        });

    NS.bridge = {
        companionRequest,
        saveReplay: (entry) =>
            companionRequest({ type: 'saveReplay', entry }).catch((err) =>
                console.error('[karabuddy] save failed:', err)
            ),
        listReplays: () =>
            companionRequest({ type: 'listReplays' }).catch((err) => {
                console.error('[karabuddy] list failed:', err);
                return [];
            }),
        getReplay: (gameId) =>
            companionRequest({ type: 'getReplay', gameId }).catch((err) => {
                console.error('[karabuddy] get failed:', err);
                return null;
            }),
        // Push a finalized replay to karabuddy.com. Best-effort; resolves to
        // { slug, url } on success or null on failure (already logged by the
        // background's catch block).
        uploadReplay: (payload) =>
            companionRequest({ type: 'uploadReplay', payload }, 15000)
                .catch((err) => {
                    console.warn('[karabuddy] upload bridge failed:', err);
                    return null;
                }),
        // Open karabuddy's replays browser. `tab` is 'mine' or 'public'.
        // Claim flow lives entirely on karabuddy.app: the /claim page auto-
        // detects the install token via karabuddy-bridge.js's postMessage
        // protocol, so the extension doesn't need its own claim entry point.
        openReplays: (tab = 'mine') =>
            companionRequest({ type: 'openReplaysPage', tab }),
        // B55c: fetch the @-mention autocomplete data (teams + members).
        // Returns null on failure or if not signed in — caller treats
        // that as "no autocomplete available, text-only mode."
        getTeamsMentionData: () =>
            companionRequest({ type: 'getTeamsMentionData' }, 8000)
                .catch(() => null),
        // B72: ask the server whether this extension version is ok / should
        // nag / is blocked. Returns null on failure — treat as ok, never
        // brick on a transient network error.
        getExtensionStatus: () =>
            companionRequest({ type: 'getExtensionStatus' }, 8000)
                .catch(() => null),
        // B67: after a replay is uploaded, apply the user's persistent
        // "share with these teams" selection. Idempotent — safe to call
        // on every snapshot+final upload. Returns { ok, applied, errors[] }
        // or null on bridge failure.
        applyTeamShares: (slug, teamSlugs) =>
            companionRequest({ type: 'applyTeamShares', slug, teamSlugs }, 10000)
                .catch(() => null),
        // B75: per-user extension settings (default share teams + the
        // min-actions upload threshold), synced via the server so they
        // persist across games AND devices. Returns null on failure /
        // not-signed-in — callers fall back to local storage / defaults.
        getUserSettings: () =>
            companionRequest({ type: 'getUserSettings' }, 6000)
                .catch(() => null),
        setUserSettings: (patch) =>
            companionRequest({ type: 'setUserSettings', patch }, 6000)
                .catch(() => null),
        // B76: chrome.storage.local routed through the SW. MAIN-world content
        // scripts (the bubble) can't touch chrome.storage directly, so this is
        // the offline-capable local cache for share state, launcher position,
        // etc. storageGet → { ok, data } | null; storageSet → { ok } | null.
        storageGet: (keys) =>
            companionRequest({ type: 'storageGet', keys }, 5000)
                .catch(() => null),
        // B80: content-free karabast-drift beacon. `issues` are codes from the
        // shared knownIssueCodes() enum only; the SW attaches the version and
        // gates on the opt-out flag. Best-effort — null on failure.
        reportHealth: (issues) =>
            companionRequest({ type: 'reportHealth', issues }, 5000)
                .catch(() => null),
        storageSet: (items) =>
            companionRequest({ type: 'storageSet', items }, 5000)
                .catch(() => null),
        // B69: minimal "who am I" lookup for the bubble's signed-in
        // indicator. Returns null on failure / not-signed-in.
        getWhoami: () =>
            companionRequest({ type: 'getWhoami' }, 5000)
                .catch(() => null),
        // B69: karabuddy endpoint URL (handles dev override). Used to
        // build the sign-in popup URL.
        getEndpoint: () =>
            companionRequest({ type: 'getEndpoint' }, 3000)
                .catch(() => null)
    };
})();
