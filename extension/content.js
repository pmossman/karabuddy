const params = new URLSearchParams(location.search);
const extSide = params.get('extSide');
const extId = params.get('extId');
const extStart = params.get('extStart');
const extDeck = params.get('extDeck');
const extLobbyId = params.get('extLobbyId');
const extFormat = params.get('extFormat') || 'premier';
const extCardPool = params.get('extCardPool') || 'current';
const extGamesToWinMode = params.get('extGamesToWinMode') || 'bestOfOne';
const extLobbyName = params.get('extLobbyName') || 'Solo Test';

// localStorage monkey-patch lives in inject-main.js — needs page-world execution at document_start, and karabast.net's CSP blocks inline injection.

const userPayload = () => ({
    id: extId,
    username: `anonymous ${extId.substring(0, 6)}`,
    provider: null,
    welcomeMessage: null,
    needsUsernameChange: false
});

const API_ORIGIN = 'https://api.karabast.net';

const fetchDeck = async (deckLink) => {
    console.log('[karabast-solo] fetching deck:', JSON.stringify(deckLink));
    const res = await fetch(`${API_ORIGIN}/api/resolve-deck-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckLink }),
        credentials: 'include'
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
        throw new Error(`${body.error || body.message || `Deck fetch failed: ${res.status}`} (link sent: ${JSON.stringify(deckLink)})`);
    }
    return body.deck;
};

// karabast's API returns `{message: ...}` for plain errors and
// `{errors: {...}}` for deck-validation failures. Surface both so the user
// can actually see what's wrong (card pool mismatch, etc).
const humanizeErrorKey = (key) =>
    String(key)
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (c) => c.toUpperCase())
        .trim();

const formatCardLike = (v) => {
    if (typeof v === 'string') return v;
    if (!v || typeof v !== 'object') return String(v);
    if (v.name && v.id) return `${v.name} (${v.id})`;
    return v.name || v.id || v.cardId || JSON.stringify(v);
};

const formatApiError = (body, fallback) => {
    if (body && typeof body === 'object') {
        if (body.message) return body.message;
        if (body.error) return body.error;
        if (body.errors && typeof body.errors === 'object') {
            const parts = [];
            const MAX = 6;
            for (const [key, val] of Object.entries(body.errors)) {
                const label = humanizeErrorKey(key);
                if (Array.isArray(val)) {
                    if (val.length === 0) continue;
                    const items = val.slice(0, MAX).map(formatCardLike);
                    const more = val.length > MAX ? ` (+${val.length - MAX} more)` : '';
                    parts.push(`${label}: ${items.join(', ')}${more}`);
                } else if (typeof val === 'object' && val !== null) {
                    parts.push(`${label}: ${JSON.stringify(val)}`);
                } else {
                    parts.push(`${label}: ${val}`);
                }
            }
            if (parts.length) return parts.join('\n');
        }
    }
    return fallback;
};

const createLobby = async (deckData) => {
    const payload = {
        user: userPayload(),
        deck: { ...deckData, deckLink: extDeck, isPresentInDb: false },
        isPrivate: true,
        format: extFormat,
        lobbyName: extLobbyName,
        cardPool: extCardPool,
        gamesToWinMode: extGamesToWinMode
    };
    const res = await fetch(`${API_ORIGIN}/api/create-lobby`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(formatApiError(body, `Create lobby failed: ${res.status}`));
    }
};

const joinLobby = async (lobbyId) => {
    const res = await fetch(`${API_ORIGIN}/api/join-lobby`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lobbyId, user: userPayload() }),
        credentials: 'include'
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(formatApiError(body, `Join lobby failed: ${res.status}`));
    }
};

const waitForLobbyIdInDom = (timeoutMs = 30000) => new Promise((resolve, reject) => {
    const start = Date.now();
    const find = () => {
        const inputs = document.querySelectorAll('input');
        for (const input of inputs) {
            const v = input.value || '';
            const match = v.match(/[?&]lobbyId=([^&]+)/);
            if (match) return decodeURIComponent(match[1]);
        }
        return null;
    };
    const tick = () => {
        const id = find();
        if (id) return resolve(id);
        if (Date.now() - start > timeoutMs) return reject(new Error('Timed out waiting for lobby ID in DOM'));
        setTimeout(tick, 200);
    };
    tick();
});

// Side B deck-load driving lives in inject-main.js — needs React's _valueTracker, only visible from the page world.

const carryExt = () =>
    `extSide=${encodeURIComponent(extSide)}&extId=${encodeURIComponent(extId)}&extDeck=${encodeURIComponent(extDeck || '')}`;

const runCreateFlow = async () => {
    const deckData = await fetchDeck(extDeck);
    await createLobby(deckData);
    location.href = `${location.origin}/lobby?${carryExt()}`;
};

const runJoinFlow = async () => {
    await joinLobby(extLobbyId);
    location.href = `${location.origin}/lobby?lobbyId=${encodeURIComponent(extLobbyId)}&${carryExt()}`;
};

const runLobbyScrape = async () => {
    const lobbyId = await waitForLobbyIdInDom();
    chrome.runtime.sendMessage({ type: 'lobbyCreated', lobbyId });
};

const main = async () => {
    if (!extSide) return;
    try {
        if (extStart === 'create' && location.pathname === '/') {
            await runCreateFlow();
        } else if (extStart === 'join' && location.pathname === '/') {
            await runJoinFlow();
        } else if (extSide === 'A' && location.pathname === '/lobby' && !location.search.includes('lobbyId=')) {
            await runLobbyScrape();
        }
    } catch (err) {
        console.error('[karabast-solo]', err);
        alert(`Karabast solo testing: ${err.message}`);
    }
};

const isTextInputFocused = () => {
    const el = document.activeElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') {
        const type = (el.type || '').toLowerCase();
        return ['', 'text', 'email', 'password', 'search', 'url', 'tel', 'number'].includes(type);
    }
    return false;
};

const installSpacebarSwap = () => {
    if (!extSide) return;
    window.addEventListener(
        'keydown',
        (e) => {
            if (e.code !== 'Space') return;
            if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
            if (e.repeat) return;
            if (isTextInputFocused()) return;
            e.preventDefault();
            e.stopPropagation();
            chrome.runtime.sendMessage({ type: 'swapFocus' });
        },
        true
    );
};

// Bridge: the replays sidebar runs in the page world and can't talk to the
// service worker directly. It dispatches `karabast-companion-action` events
// (with a `_id` correlation token); we forward them via chrome.runtime
// .sendMessage and surface the response back as `karabast-companion-result`
// with the same `_id`. Concurrent calls don't clobber each other.
const installCompanionBridge = () => {
    window.addEventListener('karabast-companion-action', (e) => {
        const detail = e.detail || {};
        const correlationId = detail._id;
        // Strip the correlation field before forwarding — the service worker
        // doesn't care about it.
        const { _id, ...payload } = detail;
        chrome.runtime.sendMessage(payload, (res) => {
            window.dispatchEvent(new CustomEvent('karabast-companion-result', {
                detail: {
                    _id: correlationId,
                    type: detail.type,
                    ok: !!res?.ok,
                    error: res?.error,
                    data: res?.data
                }
            }));
        });
    });
};

const onReady = () => {
    main();
    installSpacebarSwap();
    installCompanionBridge();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
} else {
    onReady();
}
