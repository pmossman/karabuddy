const ORIGIN = 'https://karabast.net';

const RULE_ID = { A: 1001, B: 1002 };

const stripCookiesForTab = async (side, tabId) => {
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [RULE_ID[side]],
        addRules: [{
            id: RULE_ID[side],
            priority: 1,
            action: {
                type: 'modifyHeaders',
                requestHeaders: [{ header: 'cookie', operation: 'remove' }]
            },
            condition: {
                tabIds: [tabId],
                requestDomains: ['karabast.net']
            }
        }]
    });
};

const removeAllStripRules = () =>
    chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: Object.values(RULE_ID)
    }).catch(() => {});

const DEFAULT_CONFIG = {
    sides: {
        A: { label: 'Side A', anonymousUserId: '', selectedDeckId: 'custom', customDeckLink: '' },
        B: { label: 'Side B', anonymousUserId: '', selectedDeckId: 'custom', customDeckLink: '' }
    },
    decks: [],
    match: {
        format: 'premier',
        cardPool: 'current',
        gamesToWinMode: 'bestOfOne'
    },
    session: null
};

const API_ORIGIN = 'https://api.karabast.net';

const generateId = () => crypto.randomUUID();

const migrateSide = (raw, defaults) => {
    const side = { ...defaults, ...(raw || {}) };
    if (raw && raw.deckLink && !side.customDeckLink && side.selectedDeckId === 'custom') {
        side.customDeckLink = raw.deckLink;
    }
    delete side.deckLink;
    return side;
};

const loadConfig = async () => {
    const stored = await chrome.storage.local.get(['sides', 'decks', 'match', 'session']);
    return {
        sides: {
            A: migrateSide(stored.sides?.A, DEFAULT_CONFIG.sides.A),
            B: migrateSide(stored.sides?.B, DEFAULT_CONFIG.sides.B)
        },
        decks: Array.isArray(stored.decks) ? stored.decks : [],
        match: { ...DEFAULT_CONFIG.match, ...(stored.match || {}) },
        session: stored.session || null
    };
};

const saveDecks = (decks) => chrome.storage.local.set({ decks });

const resolveSideDeckLink = (sideConfig, decks) => {
    if (sideConfig.selectedDeckId === 'custom') return sideConfig.customDeckLink || '';
    const deck = decks.find((d) => d.id === sideConfig.selectedDeckId);
    return deck?.deckLink || '';
};

const fetchDeckMeta = async (deckLink) => {
    const res = await fetch(`${API_ORIGIN}/api/resolve-deck-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckLink }),
        credentials: 'include'
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
        throw new Error(body.error || body.message || `Deck fetch failed: ${res.status}`);
    }
    return body.deck;
};

const addDeckByLink = async (deckLink, nameOverride) => {
    const trimmed = (deckLink || '').trim();
    if (!trimmed) throw new Error('Deck link is required.');
    const config = await loadConfig();
    if (config.decks.some((d) => d.deckLink === trimmed)) {
        throw new Error('That deck is already in your library.');
    }
    const meta = await fetchDeckMeta(trimmed);
    const deck = {
        id: generateId(),
        name: nameOverride?.trim() || meta?.metadata?.name || 'Unnamed deck',
        deckLink: trimmed,
        leaderId: meta?.leader?.id || '',
        baseId: meta?.base?.id || ''
    };
    const decks = [...config.decks, deck];
    await saveDecks(decks);
    return deck;
};

const removeDeck = async (deckId) => removeDecks([deckId]);

const removeDecks = async (deckIds) => {
    if (!Array.isArray(deckIds) || deckIds.length === 0) return { removed: 0 };
    const ids = new Set(deckIds);
    const config = await loadConfig();
    const before = config.decks.length;
    const decks = config.decks.filter((d) => !ids.has(d.id));
    await saveDecks(decks);
    let sidesChanged = false;
    const sides = { ...config.sides };
    for (const side of ['A', 'B']) {
        if (ids.has(sides[side].selectedDeckId)) {
            sides[side] = { ...sides[side], selectedDeckId: 'custom' };
            sidesChanged = true;
        }
    }
    if (sidesChanged) await chrome.storage.local.set({ sides });
    return { removed: before - decks.length };
};

const fetchKarabastDecks = async () => {
    const res = await fetch(`${API_ORIGIN}/api/get-decks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: {}, decks: [] }),
        credentials: 'include'
    });
    if (res.status === 403) {
        throw new Error('Karabast does not recognize you as logged in. Sign in at karabast.net first.');
    }
    const remoteDecks = await res.json();
    if (!res.ok || !Array.isArray(remoteDecks)) {
        throw new Error(`Import failed: ${res.status}`);
    }
    const config = await loadConfig();
    const existingLinks = new Set(config.decks.map((d) => d.deckLink));
    return {
        decks: remoteDecks.map((d) => ({
            name: d.name || 'Unnamed deck',
            deckLink: d.deckLink || '',
            leaderId: d.leader?.id || '',
            baseId: d.base?.id || '',
            alreadyAdded: existingLinks.has(d.deckLink)
        })),
        total: remoteDecks.length
    };
};

const addKarabastDecks = async (decks) => {
    if (!Array.isArray(decks) || decks.length === 0) return { added: 0 };
    const config = await loadConfig();
    const existingLinks = new Set(config.decks.map((d) => d.deckLink));
    const added = [];
    for (const d of decks) {
        if (!d.deckLink || existingLinks.has(d.deckLink)) continue;
        added.push({
            id: generateId(),
            name: d.name || 'Unnamed deck',
            deckLink: d.deckLink,
            leaderId: d.leaderId || '',
            baseId: d.baseId || ''
        });
        existingLinks.add(d.deckLink);
    }
    if (added.length) await saveDecks([...config.decks, ...added]);
    return { added: added.length };
};

const mintFreshAnonymousIds = (sides) => ({
    A: { ...sides.A, anonymousUserId: generateId() },
    B: { ...sides.B, anonymousUserId: generateId() }
});

const saveSides = (sides) => chrome.storage.local.set({ sides });
const saveMatch = (match) => chrome.storage.local.set({ match });
const saveSession = (session) => chrome.storage.local.set({ session });

const buildSideUrl = (side, sideConfig, deckLink, extras = {}) => {
    const url = new URL(`${ORIGIN}/`);
    url.searchParams.set('extSide', side);
    url.searchParams.set('extId', sideConfig.anonymousUserId);
    url.searchParams.set('extDeck', deckLink);
    for (const [k, v] of Object.entries(extras)) url.searchParams.set(k, v);
    return url.toString();
};

const maximizeWindow = (windowId) =>
    chrome.windows.update(windowId, { state: 'maximized' }).catch(() => {});

const startSession = async () => {
    const config = await loadConfig();
    if (config.session) {
        throw new Error('A session is already active. Stop it first.');
    }
    const resolvedDeckLinks = {
        A: resolveSideDeckLink(config.sides.A, config.decks),
        B: resolveSideDeckLink(config.sides.B, config.decks)
    };
    for (const side of ['A', 'B']) {
        if (!resolvedDeckLinks[side]) {
            throw new Error(`No deck selected for ${config.sides[side].label}.`);
        }
    }

    config.sides = mintFreshAnonymousIds(config.sides);
    await saveSides(config.sides);
    console.log(`[karabast-solo] minted fresh anon IDs: A=${config.sides.A.anonymousUserId}, B=${config.sides.B.anonymousUserId}`);

    await removeAllStripRules();

    const winA = await chrome.windows.create({
        url: 'about:blank',
        focused: true,
        type: 'normal',
        state: 'maximized'
    });
    const tabAId = winA.tabs[0].id;
    await stripCookiesForTab('A', tabAId);
    await chrome.tabs.update(tabAId, {
        url: buildSideUrl('A', config.sides.A, resolvedDeckLinks.A, {
            extStart: 'create',
            extFormat: config.match.format,
            extCardPool: config.match.cardPool,
            extGamesToWinMode: config.match.gamesToWinMode,
            extLobbyName: `Solo Test ${new Date().toISOString().slice(11, 19)}`
        })
    });
    await maximizeWindow(winA.id);

    const session = { windowAId: winA.id, tabAId, windowBId: null, tabBId: null, lobbyId: null, startedAt: Date.now() };
    await saveSession(session);
    return session;
};

const onLobbyCreated = async (lobbyId, senderWindowId) => {
    const config = await loadConfig();
    if (!config.session || config.session.windowAId !== senderWindowId) return;
    if (config.session.lobbyId) return;

    config.session.lobbyId = lobbyId;
    await saveSession(config.session);

    const winB = await chrome.windows.create({
        url: 'about:blank',
        focused: true,
        type: 'normal',
        state: 'maximized'
    });
    const tabBId = winB.tabs[0].id;
    await stripCookiesForTab('B', tabBId);
    const deckLinkB = resolveSideDeckLink(config.sides.B, config.decks);
    await chrome.tabs.update(tabBId, {
        url: buildSideUrl('B', config.sides.B, deckLinkB, {
            extStart: 'join',
            extLobbyId: lobbyId
        })
    });
    config.session.windowBId = winB.id;
    config.session.tabBId = tabBId;
    await saveSession(config.session);
    await maximizeWindow(winB.id);
};

const stopSession = async () => {
    await removeAllStripRules();
    const config = await loadConfig();
    if (!config.session) return;
    const { windowAId, windowBId } = config.session;
    for (const id of [windowAId, windowBId]) {
        if (id != null) await chrome.windows.remove(id).catch(() => {});
    }
    await chrome.storage.local.remove('session');
};

const swapFocus = async () => {
    const stored = await chrome.storage.local.get('session');
    const session = stored.session;
    if (!session) return;
    const current = await chrome.windows.getLastFocused();
    const target = current.id === session.windowAId ? session.windowBId : session.windowAId;
    if (target != null) await chrome.windows.update(target, { focused: true });
};

// -------------------- Replay browser storage (IDB on extension origin) --------------------
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
                const store = db.createObjectStore(IDB_STORE, { keyPath: 'gameId' });
                store.createIndex('savedAt', 'savedAt');
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
        const r = store.put(entry);
        r.onsuccess = resolve;
        r.onerror = () => reject(r.error);
    });
    await idbEnforceCap();
};

const idbListReplays = async () => {
    const store = await idbTx('readonly');
    return new Promise((resolve, reject) => {
        const out = [];
        const req = store.index('savedAt').openCursor(null, 'prev');
        req.onsuccess = () => {
            const cur = req.result;
            if (!cur) return resolve(out);
            const { payload, ...meta } = cur.value;
            out.push(meta);
            cur.continue();
        };
        req.onerror = () => reject(req.error);
    });
};

const idbGetReplay = async (gameId) => {
    const store = await idbTx('readonly');
    return new Promise((resolve, reject) => {
        const r = store.get(gameId);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
    });
};

const idbDeleteReplay = async (gameId) => {
    const store = await idbTx('readwrite');
    return new Promise((resolve, reject) => {
        const r = store.delete(gameId);
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
    });
};

const idbEnforceCap = async () => {
    const store = await idbTx('readwrite');
    await new Promise((resolve, reject) => {
        const seen = [];
        const req = store.index('savedAt').openKeyCursor(null, 'prev');
        req.onsuccess = () => {
            const cur = req.result;
            if (!cur) return resolve();
            seen.push(cur.primaryKey);
            if (seen.length > REPLAY_CAP) store.delete(cur.primaryKey);
            cur.continue();
        };
        req.onerror = () => reject(req.error);
    });
};

const openReplaysPage = async () => {
    const url = chrome.runtime.getURL('replays.html');
    const existing = await chrome.tabs.query({ url });
    if (existing.length > 0) {
        await chrome.tabs.update(existing[0].id, { active: true });
        await chrome.windows.update(existing[0].windowId, { focused: true });
        return;
    }
    await chrome.tabs.create({ url });
};

// Hand a replay payload to a karabast tab for playback. Uses chrome.storage.session
// keyed by gameId so the MAIN-world script can fetch it on load.
const playReplay = async (gameId) => {
    const entry = await idbGetReplay(gameId);
    if (!entry || !entry.payload) throw new Error('Replay not found');
    await chrome.storage.session.set({
        [`pendingReplay:${gameId}`]: { gameId, payload: entry.payload, queuedAt: Date.now() }
    });
    const url = `${ORIGIN}/GameBoard?spectator=true&extReplay=1&extReplayId=${encodeURIComponent(gameId)}`;
    // Prefer reusing a karabast tab if one is already open.
    const existing = await chrome.tabs.query({ url: `${ORIGIN}/*` });
    if (existing.length > 0) {
        await chrome.tabs.update(existing[0].id, { active: true, url });
        await chrome.windows.update(existing[0].windowId, { focused: true });
    } else {
        await chrome.tabs.create({ url });
    }
};

const consumePendingReplay = async (gameId) => {
    const key = `pendingReplay:${gameId}`;
    const stored = await chrome.storage.session.get(key);
    const entry = stored[key];
    if (!entry) return null;
    await chrome.storage.session.remove(key);
    return entry;
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        try {
            if (msg.type === 'lobbyCreated') {
                await onLobbyCreated(msg.lobbyId, sender.tab?.windowId);
                sendResponse({ ok: true });
            } else if (msg.type === 'swapFocus') {
                await swapFocus();
                sendResponse({ ok: true });
            } else if (msg.type === 'getShortcut') {
                const commands = await chrome.commands.getAll();
                const cmd = commands.find((c) => c.name === 'swap-focus');
                sendResponse({ ok: true, shortcut: cmd?.shortcut || '' });
            } else if (msg.type === 'addDeck') {
                const deck = await addDeckByLink(msg.deckLink, msg.name);
                sendResponse({ ok: true, deck });
            } else if (msg.type === 'removeDeck') {
                await removeDeck(msg.deckId);
                sendResponse({ ok: true });
            } else if (msg.type === 'removeDecks') {
                const result = await removeDecks(msg.deckIds);
                sendResponse({ ok: true, ...result });
            } else if (msg.type === 'fetchKarabastDecks') {
                const result = await fetchKarabastDecks();
                sendResponse({ ok: true, ...result });
            } else if (msg.type === 'addKarabastDecks') {
                const result = await addKarabastDecks(msg.decks);
                sendResponse({ ok: true, ...result });
            } else if (msg.type === 'openOptions') {
                await chrome.runtime.openOptionsPage();
                sendResponse({ ok: true });
            } else if (msg.type === 'startSession') {
                await startSession();
                sendResponse({ ok: true });
            } else if (msg.type === 'stopSession') {
                await stopSession();
                sendResponse({ ok: true });
            } else if (msg.type === 'getConfig') {
                sendResponse({ ok: true, config: await loadConfig() });
            } else if (msg.type === 'saveSides') {
                await saveSides(msg.sides);
                sendResponse({ ok: true });
            } else if (msg.type === 'saveMatch') {
                await saveMatch(msg.match);
                sendResponse({ ok: true });
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
                await openReplaysPage();
                sendResponse({ ok: true });
            } else if (msg.type === 'playReplay') {
                await playReplay(msg.gameId);
                sendResponse({ ok: true });
            } else if (msg.type === 'consumePendingReplay') {
                const entry = await consumePendingReplay(msg.gameId);
                sendResponse({ ok: true, data: entry });
            } else {
                sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
            }
        } catch (err) {
            sendResponse({ ok: false, error: err.message });
        }
    })();
    return true;
});

chrome.commands.onCommand.addListener((command) => {
    if (command === 'swap-focus') swapFocus();
});

chrome.windows.onRemoved.addListener(async (windowId) => {
    const stored = await chrome.storage.local.get('session');
    const session = stored.session;
    if (!session) return;
    if (session.windowAId === windowId || session.windowBId === windowId) {
        await stopSession();
    }
});

chrome.runtime.onStartup.addListener(() => { removeAllStripRules(); });
chrome.runtime.onInstalled.addListener(() => {
    removeAllStripRules();
    chrome.storage.local.remove('cookieSnapshot');
});
