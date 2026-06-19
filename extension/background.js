// Service worker for the KaraBuddy MV3 extension.

// B170 / ADR 0010: private-team E2EE. The SW is the sole keyholder — team keys
// live in chrome.storage.local and NEVER leave the extension. It imports the
// trusted crypto module for its side effect (attaches to self.__KaraBuddy.
// replays.e2ee — it's a classic dual-mode script, no ESM exports) and the pure
// upload-policy helpers (ESM). The SW encrypts plaintext payloads here, where
// the key meets the data, so neither the page nor the network ever sees the key.
import './replays/00-e2ee.js';
import { decideUploadMode, keyStorageKey, loadedKeyIdsFromStorage, privacyMapFromTeams } from './private-teams.js';
const e2ee = () => self.__KaraBuddy?.replays?.e2ee;

// B170 / ADR 0010: capabilities this build advertises to the webapp over the
// karabuddy-origin bridge (getCompanionInfo). The webapp FEATURE-DETECTS off
// this list — 'privateTeams' is present only because this build implements the
// encrypt/withhold/decrypt path. Add capability strings as features land; the
// webapp gates on the string, never on the version number.
const COMPANION_CAPABILITIES = ['privateTeams'];

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

// B114: recorder/client metadata stamped onto every upload. Built in the SW
// because only it can read chrome.runtime.getManifest() (the MAIN-world recorder
// can't). Lets us see which extension version + browser produced a replay
// without asking the user — e.g. diagnosing recorder gaps like the Bo3 capture
// miss. Server whitelists + length-caps these fields (lib/clientMeta.ts).
const buildClientMeta = () => {
    try {
        const m = chrome.runtime.getManifest();
        const ua = (self.navigator && self.navigator.userAgent) || '';
        let browser = 'other';
        if (/firefox/i.test(ua)) browser = 'firefox';
        else if (/edg\//i.test(ua)) browser = 'edge';
        else if (/chrome|chromium|crios/i.test(ua)) browser = 'chrome';
        return { extVersion: m.version, extVersionName: m.version_name || m.version, browser, ua };
    } catch {
        return null;
    }
};

// B170: team key storage (chrome.storage.local, namespaced by the non-secret
// kid). The key bytes (base64url) never leave the extension.
const getLoadedKeyIds = async () => {
    try { return loadedKeyIdsFromStorage(await chrome.storage.local.get(null)); }
    catch { return []; }
};
const getPrivateKey = async (teamKeyId) => {
    try {
        const k = keyStorageKey(teamKeyId);
        const r = await chrome.storage.local.get(k);
        return r[k] || null;
    } catch { return null; }
};

// B170 / ADR 0010: report this install's NON-SECRET readiness (capabilities +
// which team_key_ids have a key loaded — never the key) so a team owner's
// private-mode roster can show ready / needs-update / needs-key. Best-effort;
// fired on startup + whenever a key is loaded/forgotten. 401 (not signed in /
// unlinked) is a harmless no-op.
const reportExtensionReadiness = async () => {
    try {
        const endpoint = await getKarabuddyEndpoint();
        const installToken = await getKarabuddyInstallToken();
        await fetch(`${endpoint}/api/me/extension/readiness`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
            body: JSON.stringify({ capabilities: COMPANION_CAPABILITIES, loadedTeamKeyIds: await getLoadedKeyIds() }),
        });
    } catch {}
};

// B170: which armed teams are private (+ their non-secret kid). Fetched fresh
// from teams-mention-data and CACHED, so an offline upload still knows a team is
// private and withholds rather than leaking plaintext. If never fetched + offline
// we return {} (plaintext path) — the server's shareAllowed backstop still
// prevents any plaintext reaching a private team's members.
const TEAM_PRIVACY_CACHE = 'karabuddyTeamPrivacyCache';
const getTeamPrivacy = async (endpoint, installToken) => {
    try {
        const res = await fetch(`${endpoint}/api/me/teams-mention-data`, {
            credentials: 'include',
            headers: { 'X-Install-Token': installToken },
        });
        if (res.ok) {
            const body = await res.json();
            const map = privacyMapFromTeams(body.teams);
            try { await chrome.storage.local.set({ [TEAM_PRIVACY_CACHE]: map }); } catch {}
            return map;
        }
    } catch {}
    try { return (await chrome.storage.local.get(TEAM_PRIVACY_CACHE))[TEAM_PRIVACY_CACHE] || {}; }
    catch { return {}; }
};

// Pull the karabast gameId out of a plaintext payload (first gamestate snapshot)
// so an encrypted upload can carry it in the clear for periodic-snapshot dedup.
const extractGameId = (parsed) => {
    try {
        const fg = (parsed?.events || []).find((e) => e.event === 'gamestate' && e.args?.[0]);
        const snap = fg?.args?.[0]?.full || (parsed?.version === 1 ? fg?.args?.[0] : null);
        return snap?.id || null;
    } catch { return null; }
};

// Upload a recorded replay. B170: decides plaintext / encrypt / WITHHOLD based on
// the armed teams' privacy + which keys are loaded. The recorder passes the
// plaintext payload (+ a pre-built summary); for a private team the SW encrypts
// BOTH here under the loaded team key and posts ciphertext — the key never
// crosses the bridge or the network. If a private team is armed without its key,
// the SW WITHHOLDS (returns {withheld:true}, posts nothing) so no plaintext ever
// leaves the browser; the recorder keeps the recording local and prompts.
const uploadReplayToKarabuddy = async (payloadText, summary = null) => {
    const endpoint = await getKarabuddyEndpoint();
    const installToken = await getKarabuddyInstallToken();
    // B71: armed teams accompany the upload (server applies them as shares before
    // lifting in-game tags, so tag default scope resolves to those teams).
    const armed = await getShareTeamSlugs();

    let decision = { mode: 'plaintext', shareTeamSlugs: armed };
    if (armed.length) {
        const privacyBySlug = await getTeamPrivacy(endpoint, installToken);
        const loadedKeyIds = await getLoadedKeyIds();
        decision = decideUploadMode({ armed, privacyBySlug, loadedKeyIds });
    }

    // WITHHOLD: a private team is armed but we can't encrypt for it. Upload
    // nothing — the recorder keeps it local and prompts to load the key.
    if (decision.mode === 'withhold') {
        return { withheld: true, reason: decision.reason, teams: decision.teams || [], teamKeyId: decision.teamKeyId || null };
    }

    if (decision.mode === 'encrypt') {
        const e = e2ee();
        const key = await getPrivateKey(decision.teamKeyId);
        // Fail CLOSED — never fall back to plaintext for a private team.
        if (!e || !key) return { withheld: true, reason: 'no-key', teamKeyId: decision.teamKeyId, teams: decision.shareTeamSlugs };
        let parsed = null; try { parsed = JSON.parse(payloadText); } catch {}
        const payloadEnv = await e.encryptContent(key, payloadText);
        const summaryEnv = await e.encryptContent(key, JSON.stringify(summary || { v: 1 }));
        const res = await fetch(`${endpoint}/api/replays`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                installToken,
                encrypted: true,
                teamKeyId: decision.teamKeyId,
                gameId: extractGameId(parsed),
                payload: JSON.stringify(payloadEnv),
                encryptedSummary: JSON.stringify(summaryEnv),
                shareTeamSlugs: decision.shareTeamSlugs,
                actionCount: parsed?.actionCount || 0,
                durationMs: parsed?.durationMs || 0,
                ...(buildClientMeta() ? { clientMeta: buildClientMeta() } : {}),
            }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Upload failed: ${res.status}`);
        }
        return await res.json();
    }

    // Plaintext path (unchanged behavior for non-private teams).
    const res = await fetch(`${endpoint}/api/replays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            installToken,
            payload: payloadText,
            ...(decision.shareTeamSlugs && decision.shareTeamSlugs.length ? { shareTeamSlugs: decision.shareTeamSlugs } : {}),
            ...(buildClientMeta() ? { clientMeta: buildClientMeta() } : {}),
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
                matchup: entry.matchup,
                // B170: surface upload state + player meta so the bubble can list
                // local recordings NOT yet uploaded (no karabuddySlug) and offer
                // to upload them — encrypted, if a private team is armed + keyed.
                karabuddySlug: entry.karabuddySlug || null,
                players: entry.players || null,
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
                // B170: msg.summary is the plaintext matchup summary the SW
                // encrypts for a private upload (ignored on the plaintext path).
                try {
                    const result = await uploadReplayToKarabuddy(msg.payload, msg.summary || null);
                    sendResponse({ ok: true, data: result });
                } catch (err) {
                    console.warn('[karabuddy] upload failed:', err);
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'storePrivateTeamKey') {
                // B170: store a team key (base64url) under its non-secret kid.
                // Defense: the key must actually derive to that kid, so a typo
                // can't silently store under the wrong id (then fail to decrypt).
                try {
                    const teamKeyId = String(msg.teamKeyId || '');
                    const key = String(msg.key || '');
                    if (!teamKeyId || !key) { sendResponse({ ok: false, error: 'teamKeyId + key required' }); return; }
                    const e = e2ee();
                    if (e && (await e.teamKeyId(key)) !== teamKeyId) {
                        sendResponse({ ok: false, error: 'key does not match teamKeyId' });
                        return;
                    }
                    await chrome.storage.local.set({ [keyStorageKey(teamKeyId)]: key });
                    reportExtensionReadiness(); // key set → refresh the owner roster
                    sendResponse({ ok: true });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'listPrivateTeamKeyIds') {
                try {
                    sendResponse({ ok: true, data: await getLoadedKeyIds() });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'revealPrivateTeamKey') {
                // B170 / ADR 0010 — return a STORED key's value so an owner can
                // (re-)share it with teammates, especially LATE JOINERS (the key
                // is otherwise only shown at generation). HARD-gated to the
                // extension's OWN trusted pages (keys.html): a content-script
                // sender — karabast.net OR karabuddy.app — has an http(s)
                // sender.url and is REFUSED, so no web page (ours or karabast's,
                // even via content.js's un-allowlisted relay) can ever pull a key
                // out. Deliberately NOT on the webapp bridge allowlist either.
                try {
                    const fromExtPage = typeof sender?.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
                    if (!fromExtPage) { sendResponse({ ok: false, error: 'forbidden' }); return; }
                    const key = await getPrivateKey(String(msg.teamKeyId || ''));
                    if (!key) { sendResponse({ ok: false, error: 'no-key' }); return; }
                    sendResponse({ ok: true, data: { key } });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'rotationManifest' || msg.type === 'rotationRewrap' || msg.type === 'rotationFinalize') {
                // B170 / ADR 0010 — key rotation, driven entirely from the
                // extension's key-manager page. These proxy the owner-gated
                // rotation endpoints with the install token (so no webapp session
                // is needed). HARD-gated to the extension's OWN pages (like
                // reveal): a content-script sender (karabast/karabuddy) is refused,
                // so no web page can trigger a rotation.
                try {
                    const fromExtPage = typeof sender?.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
                    if (!fromExtPage) { sendResponse({ ok: false, error: 'forbidden' }); return; }
                    const endpoint = await getKarabuddyEndpoint();
                    const installToken = await getKarabuddyInstallToken();
                    const hdrs = { 'Content-Type': 'application/json', 'X-Install-Token': installToken };
                    let res;
                    if (msg.type === 'rotationManifest') {
                        res = await fetch(`${endpoint}/api/teams/${encodeURIComponent(msg.teamSlug)}/rotation-manifest`, { credentials: 'include', headers: { 'X-Install-Token': installToken } });
                    } else if (msg.type === 'rotationRewrap') {
                        res = await fetch(`${endpoint}/api/replays/${encodeURIComponent(msg.slug)}/rewrap`, {
                            method: 'POST', credentials: 'include', headers: hdrs,
                            body: JSON.stringify({ newTeamKeyId: msg.newTeamKeyId, payload: msg.payload, encryptedSummary: msg.encryptedSummary, tags: msg.tags || [] }),
                        });
                    } else {
                        res = await fetch(`${endpoint}/api/teams/${encodeURIComponent(msg.teamSlug)}/rotation-manifest`, {
                            method: 'POST', credentials: 'include', headers: hdrs,
                            body: JSON.stringify({ newTeamKeyId: msg.newTeamKeyId }),
                        });
                    }
                    const body = await res.json().catch(() => ({}));
                    if (!res.ok && !body.error) body.error = `server error (${res.status})`;
                    sendResponse({ ok: res.ok && body.ok !== false, data: body, status: res.status });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message, data: { error: err.message } });
                }
            } else if (msg.type === 'listPrivateTeamKeys') {
                // B170: loaded keys WITH their local names (non-secret) so the
                // webapp's private-mode toggle can show "Worlds Squad" not a raw id.
                try {
                    const kids = await getLoadedKeyIds();
                    const labels = (await chrome.storage.local.get('karabuddyPrivateKeyLabels')).karabuddyPrivateKeyLabels || {};
                    sendResponse({ ok: true, data: kids.map((kid) => ({ teamKeyId: kid, name: labels[kid] || null })) });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'getCompanionInfo') {
                // B170: capability handshake for the webapp (via karabuddy-bridge).
                // Also a natural moment to refresh readiness (the user is on a
                // karabuddy page, so likely signed in) — fire-and-forget.
                try {
                    reportExtensionReadiness();
                    sendResponse({ ok: true, data: { version: chrome.runtime.getManifest().version, capabilities: COMPANION_CAPABILITIES } });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'decryptForTeam') {
                // B170: decrypt an envelope under a team key the SW holds. Returns
                // PLAINTEXT to the page; the key never leaves the extension. 'no-key'
                // when this device hasn't loaded the team's key.
                try {
                    const e = e2ee();
                    const key = await getPrivateKey(String(msg.teamKeyId || ''));
                    if (!e || !key) { sendResponse({ ok: false, error: 'no-key' }); return; }
                    let env = msg.envelope;
                    if (typeof env === 'string') { try { env = JSON.parse(env); } catch {} }
                    const plaintext = await e.decryptContent(key, env);
                    sendResponse({ ok: true, data: { plaintext } });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'encryptForTeam') {
                // B170: encrypt page-supplied plaintext (e.g. a tag comment) under a
                // team key, so web authoring keeps the key out of the page too.
                try {
                    const e = e2ee();
                    const key = await getPrivateKey(String(msg.teamKeyId || ''));
                    if (!e || !key) { sendResponse({ ok: false, error: 'no-key' }); return; }
                    const envelope = await e.encryptContent(key, String(msg.plaintext ?? ''));
                    sendResponse({ ok: true, data: { envelope } });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'rewrapForTeam') {
                // B170 / ADR 0010 — key rotation. Re-wrap an envelope's data key
                // from the OLD team key to the NEW one (both held here in
                // storage). The content ciphertext is untouched (rewrapKey), so
                // this is cheap even for large payloads — only the wrapped DK +
                // kid change. Returns the re-wrapped envelope; the keys never
                // leave the extension. 'no-key' if either key isn't loaded.
                try {
                    const e = e2ee();
                    const oldKey = await getPrivateKey(String(msg.oldTeamKeyId || ''));
                    const newKey = await getPrivateKey(String(msg.newTeamKeyId || ''));
                    if (!e || !oldKey || !newKey) { sendResponse({ ok: false, error: 'no-key' }); return; }
                    let env = msg.envelope;
                    if (typeof env === 'string') { try { env = JSON.parse(env); } catch {} }
                    const rewrapped = await e.rewrapKey(oldKey, newKey, env);
                    sendResponse({ ok: true, data: { envelope: rewrapped } });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'openKeyManager') {
                // B170: open the extension's trusted key-management page in a new
                // tab (chrome-extension:// origin — not an operator-served page).
                // Lets the webapp's "load your team key" gate launch it directly
                // so users don't have to hunt for the toolbar icon. `makePrivate`
                // (a team slug) deep-links a focused "generate this team's key to
                // enable private mode" panel — the page re-verifies ownership.
                try {
                    let url = chrome.runtime.getURL('keys.html');
                    if (typeof msg.makePrivate === 'string' && msg.makePrivate) {
                        url += '?makePrivate=' + encodeURIComponent(msg.makePrivate);
                    }
                    await chrome.tabs.create({ url });
                    sendResponse({ ok: true });
                } catch (err) {
                    sendResponse({ ok: false, error: err.message });
                }
            } else if (msg.type === 'forgetPrivateTeamKey') {
                try {
                    await chrome.storage.local.remove(keyStorageKey(String(msg.teamKeyId || '')));
                    reportExtensionReadiness(); // key forgotten → refresh the owner roster
                    sendResponse({ ok: true });
                } catch (err) {
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
            } else if (msg.type === 'getPrivacyStatus') {
                // B170 / ADR 0010: the in-game bubble's at-a-glance lock state.
                // Runs the SAME decideUploadMode the real upload uses over the
                // currently-armed teams + loaded keys (single source of truth, so
                // the chip can't drift), and resolves team names for the tooltip.
                try {
                    const armed = await getShareTeamSlugs();
                    if (!armed.length) { sendResponse({ ok: true, data: { mode: 'plaintext', teamNames: [] } }); return; }
                    const endpoint = await getKarabuddyEndpoint();
                    const installToken = await getKarabuddyInstallToken();
                    let teams = [];
                    try {
                        const res = await fetch(`${endpoint}/api/me/teams-mention-data`, { credentials: 'include', headers: { 'X-Install-Token': installToken } });
                        if (res.ok) { const body = await res.json(); teams = body.teams || []; }
                    } catch {}
                    const privacyBySlug = teams.length ? privacyMapFromTeams(teams) : await getTeamPrivacy(endpoint, installToken);
                    const loadedKeyIds = await getLoadedKeyIds();
                    const decision = decideUploadMode({ armed, privacyBySlug, loadedKeyIds });
                    const involved = decision.teams || decision.shareTeamSlugs || [];
                    const teamNames = involved.map((s) => (teams.find((t) => t.slug === s) || {}).name || s);
                    sendResponse({ ok: true, data: { mode: decision.mode, reason: decision.reason || null, teamNames } });
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
