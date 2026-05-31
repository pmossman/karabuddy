// Service worker for the KaraBuddy MV3 extension.

// Debug logging — off in shipped builds. Flip on at runtime via
//   chrome.storage.local.set({karabuddyDebug: true})
// Reads cached + updates on storage changes so toggling takes effect
// without an extension reload.
let DEBUG_FLAG = false;
chrome.storage.local.get('karabuddyDebug').then(({ karabuddyDebug }) => {
    DEBUG_FLAG = karabuddyDebug === true || karabuddyDebug === '1';
}).catch(() => {});
chrome.storage.onChanged.addListener((changes) => {
    if ('karabuddyDebug' in changes) {
        const v = changes.karabuddyDebug.newValue;
        DEBUG_FLAG = v === true || v === '1';
    }
});
const SWLOG = (...args) => { if (DEBUG_FLAG) console.info('[karabuddy:sw]', ...args); };
//
// Scope after the solo-testing removal: receive replay payloads from the
// MAIN-world recorder via the companion bridge, persist locally to IndexedDB,
// best-effort push to karabuddy.app, and open karabuddy.app routes when the
// user clicks the toolbar icon or the in-page floating-launcher links.

// ----- karabuddy.app endpoint resolution -----
// Defaults to prod. Override locally via:
//   chrome.storage.local.set({ karabuddyEndpoint: 'http://localhost:3000' })
const KARABUDDY_DEFAULT = 'https://karabuddy.app';

const getKarabuddyEndpoint = async () => {
    try {
        const { karabuddyEndpoint } = await chrome.storage.local.get('karabuddyEndpoint');
        return karabuddyEndpoint || KARABUDDY_DEFAULT;
    } catch {
        return KARABUDDY_DEFAULT;
    }
};

const getKarabuddyInstallToken = async () => {
    try {
        const { karabuddyInstallToken } = await chrome.storage.local.get('karabuddyInstallToken');
        if (karabuddyInstallToken) return karabuddyInstallToken;
        const fresh = 'kbx_' + crypto.randomUUID();
        await chrome.storage.local.set({ karabuddyInstallToken: fresh });
        return fresh;
    } catch {
        return 'kbx_ephemeral';
    }
};

// B71: the bubble's currently-armed team selection (05-footer.js persists
// it to chrome.storage.local). The SW reads it directly so the upload can
// carry it.
const getShareTeamSlugs = async () => {
    try {
        const { karabuddyShareTeamSlugs } = await chrome.storage.local.get('karabuddyShareTeamSlugs');
        return Array.isArray(karabuddyShareTeamSlugs) ? karabuddyShareTeamSlugs : [];
    } catch {
        return [];
    }
};

const uploadReplayToKarabuddy = async (payloadText) => {
    const endpoint = await getKarabuddyEndpoint();
    const installToken = await getKarabuddyInstallToken();
    // B71: send the armed teams WITH the upload. The server applies them as
    // shares BEFORE lifting the in-game tags, so each tag's default scope
    // resolves to those teams (rather than personal, which is what would
    // happen if shares were only applied by the separate call below — it
    // runs after the upload has already lifted + scoped the tags).
    const shareTeamSlugs = await getShareTeamSlugs();
    const res = await fetch(`${endpoint}/api/replays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            installToken,
            payload: payloadText,
            ...(shareTeamSlugs.length ? { shareTeamSlugs } : {}),
        })
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Upload failed: ${res.status}`);
    }
    return await res.json();
};

// Post owner-only team-share rows for an already-uploaded replay.
// One row per team slug. Server dedupes by PK so calling twice with the
// same set is a no-op; safe to invoke from both periodic + final upload
// paths. Returns { ok, applied, errors[] }.
const applyTeamSharesToReplay = async ({ slug, teamSlugs }) => {
    if (!slug || !Array.isArray(teamSlugs) || teamSlugs.length === 0) {
        return { ok: true, applied: 0, errors: [] };
    }
    const endpoint = await getKarabuddyEndpoint();
    const installToken = await getKarabuddyInstallToken();
    const errors = [];
    let applied = 0;
    for (const teamSlug of teamSlugs) {
        try {
            const res = await fetch(`${endpoint}/api/replays/${slug}/team-shares`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Install-Token': installToken,
                },
                body: JSON.stringify({ teamSlug })
            });
            if (res.ok) {
                applied++;
            } else {
                const body = await res.json().catch(() => ({}));
                errors.push({ teamSlug, error: body.error || `HTTP ${res.status}` });
            }
        } catch (err) {
            errors.push({ teamSlug, error: String(err && err.message || err) });
        }
    }
    return { ok: errors.length === 0, applied, errors };
};

// ----- IndexedDB: local replay store -----
const IDB_NAME = 'karabast-replays';
const IDB_STORE = 'replays';
const REPLAY_CAP = 50;

let idbReady = null;
const idbOpen = () => {
    if (idbReady) return idbReady;
    idbReady = new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE, { keyPath: 'gameId' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return idbReady;
};

const idbTx = async (mode) => {
    const db = await idbOpen();
    return db.transaction(IDB_STORE, mode).objectStore(IDB_STORE);
};

const idbSaveReplay = async (entry) => {
    const store = await idbTx('readwrite');
    await new Promise((resolve, reject) => {
        const req = store.put(entry);
        req.onsuccess = resolve;
        req.onerror = () => reject(req.error);
    });
    await idbEnforceCap();
};

const idbListReplays = async () => {
    const store = await idbTx('readonly');
    return await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => {
            const list = (req.result || []).map((entry) => ({
                gameId: entry.gameId,
                savedAt: entry.savedAt,
                size: entry.payload?.length || 0,
                matchup: entry.matchup
            }));
            list.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
            resolve(list);
        };
        req.onerror = () => reject(req.error);
    });
};

const idbGetReplay = async (gameId) => {
    const store = await idbTx('readonly');
    return await new Promise((resolve, reject) => {
        const req = store.get(gameId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
};

const idbDeleteReplay = async (gameId) => {
    const store = await idbTx('readwrite');
    await new Promise((resolve, reject) => {
        const req = store.delete(gameId);
        req.onsuccess = resolve;
        req.onerror = () => reject(req.error);
    });
};

const idbEnforceCap = async () => {
    const store = await idbTx('readwrite');
    const all = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
    if (all.length <= REPLAY_CAP) return;
    all.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
    const cull = all.slice(0, all.length - REPLAY_CAP);
    for (const entry of cull) {
        await new Promise((resolve, reject) => {
            const req = store.delete(entry.gameId);
            req.onsuccess = resolve;
            req.onerror = () => reject(req.error);
        });
    }
};

const openReplaysPage = async ({ tab = 'mine' } = {}) => {
    const endpoint = await getKarabuddyEndpoint();
    const safeTab = tab === 'public' ? 'public' : 'mine';
    const url = `${endpoint}/replays?tab=${safeTab}`;
    const existing = await chrome.tabs.query({ url: `${endpoint}/replays*` });
    if (existing.length > 0) {
        await chrome.tabs.update(existing[0].id, { active: true, url });
        await chrome.windows.update(existing[0].windowId, { focused: true });
        return;
    }
    await chrome.tabs.create({ url });
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    SWLOG('msg', msg && msg.type, 'from', sender && (sender.tab && sender.tab.url || sender.url || 'unknown'));
    (async () => {
        try {
            if (msg.type === 'uploadReplay') {
                // Best-effort push to karabuddy.app. Failure leaves the replay
                // local-only; the floating panel still shows the recording.
                try {
                    const result = await uploadReplayToKarabuddy(msg.payload);
                    sendResponse({ ok: true, data: result });
                } catch (err) {
                    console.warn('[karabuddy] upload failed:', err);
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'saveReplay') {
                await idbSaveReplay(msg.entry);
                sendResponse({ ok: true });
            } else if (msg.type === 'listReplays') {
                const list = await idbListReplays();
                sendResponse({ ok: true, data: list });
            } else if (msg.type === 'getReplay') {
                const entry = await idbGetReplay(msg.gameId);
                sendResponse({ ok: true, data: entry });
            } else if (msg.type === 'deleteReplay') {
                await idbDeleteReplay(msg.gameId);
                sendResponse({ ok: true });
            } else if (msg.type === 'openReplaysPage') {
                await openReplaysPage({ tab: msg.tab });
                sendResponse({ ok: true });
            } else if (msg.type === 'getEndpoint') {
                // B69: tell the page-world bubble where karabuddy.app
                // lives so it can open a sign-in popup at the right URL
                // (dev override comes from chrome.storage.local).
                try {
                    const endpoint = await getKarabuddyEndpoint();
                    sendResponse({ ok: true, endpoint });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'getWhoami') {
                try {
                    const endpoint = await getKarabuddyEndpoint();
                    const installToken = await getKarabuddyInstallToken();
                    const url = `${endpoint}/api/me/whoami`;
                    SWLOG('getWhoami fetch', url, 'token', installToken.slice(0, 12) + '…');
                    const res = await fetch(url, {
                        credentials: 'include',
                        headers: { 'X-Install-Token': installToken },
                    });
                    SWLOG('getWhoami response', res.status);
                    if (res.status === 401) {
                        sendResponse({ ok: false, error: 'not signed in', status: 401 });
                        return;
                    }
                    const body = await res.json();
                    SWLOG('getWhoami body', body);
                    sendResponse({ ok: !!body.ok, data: body, status: res.status });
                } catch (err) {
                    SWLOG('getWhoami threw', err && err.message || err);
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'applyTeamShares') {
                // B67: route N share POSTs through the SW so the request
                // origin is karabuddy.app (no page-world CORS) and the
                // install token is sourced from extension storage instead
                // of being readable from the karabast page.
                try {
                    const result = await applyTeamSharesToReplay({ slug: msg.slug, teamSlugs: msg.teamSlugs });
                    sendResponse({ ok: result.ok, data: result });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'getTeamsMentionData') {
                // B55c: proxy fetch of karabuddy.app's mention data API.
                // Routed through the SW so the page world doesn't deal
                // with cross-origin CORS. B67: install token sent as
                // header — Auth.js's SameSite=Lax session cookie isn't
                // reliable on cross-origin extension fetches, but the
                // install token is already linked to a user via the
                // extension_tokens table, so the server resolves us via
                // either credential.
                try {
                    const endpoint = await getKarabuddyEndpoint();
                    const installToken = await getKarabuddyInstallToken();
                    const res = await fetch(`${endpoint}/api/me/teams-mention-data`, {
                        credentials: 'include',
                        headers: { 'X-Install-Token': installToken },
                    });
                    if (res.status === 401) {
                        sendResponse({ ok: false, error: 'not signed in', status: 401 });
                        return;
                    }
                    const body = await res.json();
                    sendResponse({ ok: !!body.ok, data: body, status: res.status });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'getUserSettings') {
                // B75: read the user's synced extension settings (default
                // share teams + min-actions upload threshold). Same auth as
                // getTeamsMentionData (session cookie OR install-token header).
                try {
                    const endpoint = await getKarabuddyEndpoint();
                    const installToken = await getKarabuddyInstallToken();
                    const res = await fetch(`${endpoint}/api/me/settings`, {
                        credentials: 'include',
                        headers: { 'X-Install-Token': installToken },
                    });
                    if (res.status === 401) {
                        sendResponse({ ok: false, error: 'not signed in', status: 401 });
                        return;
                    }
                    const body = await res.json();
                    sendResponse({ ok: !!body.ok, data: body, status: res.status });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'setUserSettings') {
                // B75: PATCH the user's synced extension settings.
                try {
                    const endpoint = await getKarabuddyEndpoint();
                    const installToken = await getKarabuddyInstallToken();
                    const res = await fetch(`${endpoint}/api/me/settings`, {
                        method: 'PATCH',
                        credentials: 'include',
                        headers: { 'X-Install-Token': installToken, 'Content-Type': 'application/json' },
                        body: JSON.stringify(msg.patch || {}),
                    });
                    if (res.status === 401) {
                        sendResponse({ ok: false, error: 'not signed in', status: 401 });
                        return;
                    }
                    const body = await res.json();
                    sendResponse({ ok: !!body.ok, data: body, status: res.status });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'reportHealth') {
                // B80: content-free karabast-drift beacon. The SW attaches the
                // authoritative ext version and honours the opt-out flag, so
                // the page world never has to. No install token / auth — the
                // payload carries only predefined structural-check codes.
                try {
                    const optOut = await chrome.storage.local.get('karabuddyHealthOptOut');
                    if (optOut && optOut.karabuddyHealthOptOut) {
                        sendResponse({ ok: true, skipped: true });
                        return;
                    }
                    const endpoint = await getKarabuddyEndpoint();
                    const version = chrome.runtime.getManifest().version;
                    const issues = Array.isArray(msg.issues) ? msg.issues : [];
                    const res = await fetch(`${endpoint}/api/extension/health`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ version, issues }),
                    });
                    sendResponse({ ok: res.ok });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'storageGet') {
                // B76: chrome.storage.local read on behalf of the MAIN-world
                // bubble (which has no direct chrome.storage access).
                try {
                    const data = await chrome.storage.local.get(msg.keys || null);
                    sendResponse({ ok: true, data });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'storageSet') {
                try {
                    await chrome.storage.local.set(msg.items || {});
                    sendResponse({ ok: true });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'getExtensionStatus') {
                // B72: graduated kill-switch. Ask the server whether this
                // version is ok/nag/block. CORS-open + no auth needed.
                try {
                    const endpoint = await getKarabuddyEndpoint();
                    const version = chrome.runtime.getManifest().version;
                    const res = await fetch(`${endpoint}/api/extension/status?v=${encodeURIComponent(version)}`);
                    const body = await res.json();
                    sendResponse({ ok: !!body.ok, data: body });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else {
                sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
            }
        } catch (err) {
            sendResponse({ ok: false, error: err.message });
        }
    })();
    return true;
});

// Toolbar icon click → open the user's karabuddy replays tab.
chrome.action.onClicked.addListener(() => {
    openReplaysPage().catch((err) => console.error('[karabuddy] openReplaysPage failed:', err));
});

// B69: on a fresh install, open karabuddy.app in a new tab so the
// AutoClaim path fires the moment the user signs in (or immediately if
// they already have a karabuddy session in this browser). Without this,
// the install token sits unlinked until the user happens to navigate to
// karabuddy.app themselves — confusing for users who installed the
// extension first.
//
// We deliberately do NOT open on `reason === 'update'`: the install
// token persists across updates (chrome.storage.local survives them),
// so the link, once made, stays. Opening a tab on every update would
// be noisy.
//
// We also only open if no karabuddy.app tab is already open — avoids
// double-popping a tab the user already has.
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason !== 'install') return;
    try {
        const endpoint = await getKarabuddyEndpoint();
        const existing = await chrome.tabs.query({ url: `${endpoint}/*` });
        if (existing.length > 0) return;
        await chrome.tabs.create({ url: endpoint });
    } catch (err) {
        console.warn('[karabuddy] onInstalled tab open failed:', err);
    }
});
