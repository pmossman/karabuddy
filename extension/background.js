// Service worker for the KaraBuddy MV3 extension.
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

const uploadReplayToKarabuddy = async (payloadText) => {
    const endpoint = await getKarabuddyEndpoint();
    const installToken = await getKarabuddyInstallToken();
    const res = await fetch(`${endpoint}/api/replays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installToken, payload: payloadText })
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Upload failed: ${res.status}`);
    }
    return await res.json();
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
            } else if (msg.type === 'getTeamsMentionData') {
                // B55c: proxy fetch of karabuddy.app's mention data API.
                // Caller is the page-world recorder/footer; can't fetch
                // cross-origin from MAIN, so we route through the SW which
                // has host_permissions on karabuddy.app. Cookies (auth
                // session) ride along with `credentials: 'include'`.
                try {
                    const endpoint = await getKarabuddyEndpoint();
                    const res = await fetch(`${endpoint}/api/me/teams-mention-data`, {
                        credentials: 'include',
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
