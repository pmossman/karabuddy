// ISOLATED-world content script on karabast.net.
//
// Sole job: bridge MAIN-world dispatched events (from the replays content
// scripts) to the service worker via chrome.runtime.sendMessage, and surface
// the response back as a `karabast-companion-result` event with the same
// correlation id.
//
// MAIN world can't call chrome.runtime directly; this bridge is the only
// way the replay recorder + footer panel can talk to background.js.

// When the user reloads or updates the extension while a karabast.net tab is
// already open, this content.js stays in the page but its chrome.* handles
// become dead. Any chrome.runtime.sendMessage from that point throws
// "Extension context invalidated." The fix on the user's side is to refresh
// the tab; we make that prompt discoverable by surfacing a sentinel event
// the MAIN-world bootstrap can hang a persistent toast off of.
const fireContextInvalidated = () => {
    try {
        window.dispatchEvent(new CustomEvent('karabast-companion-context-invalidated'));
    } catch {}
};

const isContextInvalidatedError = (err) =>
    String(err && err.message || err).includes('Extension context invalidated');

// B103 (Firefox): Firefox isolates content-script objects from the page via
// Xray vision — a CustomEvent whose `detail` we build here can't be read by
// MAIN-world page scripts (01-namespace) unless we clone it into the page's
// scope. `cloneInto` exists only on Gecko; Chrome reads the object directly,
// so guard on it. (The reverse direction — us reading the page's action
// `detail` — works via Xray, so only outbound dispatches need this.)
const toPageDetail = (detail) =>
    (typeof cloneInto !== 'undefined') ? cloneInto(detail, window) : detail;

// B170 / ADR 0010 — ALLOWLIST for the karabast.net → service-worker relay.
// karabast.net is a third party we don't control, and ANY MAIN-world script on
// the page (not just our bubble) can dispatch karabast-companion-action events
// into this isolated-world listener. So we relay ONLY the message types the
// in-game bubble actually needs, and deliberately EXCLUDE the leak vectors:
//   - decryptForTeam / encryptForTeam — the bubble never uses them; a page must
//     never be able to turn the extension into a decryption oracle.
//   - revealPrivateTeamKey — returns a key's value (also SW origin-gated to the
//     extension's own pages; this is defense-in-depth).
//   - getCompanionInfo / openKeyManager — webapp-bridge concerns, not the bubble.
// Key ENTRY now lives in the extension's own key-manager page, so the bubble only
// LISTS loaded kids (non-secret) and OPENS the manager — store/forget are no
// longer relayed from karabast at all. openKeyManager just opens a tab (worst
// case a hostile page opens it — annoying, not a leak).
const ALLOWED_SW_ACTIONS = new Set([
    'saveReplay', 'listReplays', 'getReplay',
    'uploadReplay', 'applyTeamShares',
    'listPrivateTeamKeyIds', 'openKeyManager',
    'getPrivacyStatus',
    'getWhoami', 'getEndpoint', 'getTeamsMentionData', 'getUserSettings', 'setUserSettings',
    'openReplaysPage', 'getExtensionStatus', 'reportHealth', 'storageGet', 'storageSet',
]);

const installCompanionBridge = () => {
    window.addEventListener('karabast-companion-action', (e) => {
        const detail = e.detail || {};
        const correlationId = detail._id;
        const { _id, ...payload } = detail;
        const dispatchResult = (ok, error, data) => {
            window.dispatchEvent(new CustomEvent('karabast-companion-result', {
                detail: toPageDetail({ _id: correlationId, type: detail.type, ok, error, data })
            }));
        };
        // Drop anything not on the allowlist before it can reach the SW.
        if (!payload || typeof payload.type !== 'string' || !ALLOWED_SW_ACTIONS.has(payload.type)) {
            dispatchResult(false, 'unsupported companion request');
            return;
        }
        try {
            chrome.runtime.sendMessage(payload, (res) => {
                // chrome.runtime.lastError can fire even on async path if the
                // service worker died mid-request; treat it like a context loss.
                if (chrome.runtime.lastError) {
                    if (isContextInvalidatedError(chrome.runtime.lastError)) fireContextInvalidated();
                    dispatchResult(false, String(chrome.runtime.lastError.message || chrome.runtime.lastError));
                    return;
                }
                dispatchResult(!!res?.ok, res?.error, res?.data);
            });
        } catch (err) {
            // Synchronous throw — usually means the extension was reloaded.
            if (isContextInvalidatedError(err)) fireContextInvalidated();
            // Resolve the pending request fast instead of waiting on its
            // timeout, so the recorder's error path runs while the user is
            // still looking.
            dispatchResult(false, String(err && err.message || err));
        }
    });
};

// Proactive context-validity check — surfaces the persistent toast even if
// the user hasn't tried anything yet (the moment after they reload the
// extension, they get told to refresh karabast). Stops once invalidated.
const startContextWatchdog = () => {
    const tick = () => {
        try {
            // chrome.runtime.id read throws after invalidation in MV3.
            if (chrome.runtime && chrome.runtime.id) return;
        } catch {}
        fireContextInvalidated();
        clearInterval(handle);
    };
    const handle = setInterval(tick, 5000);
};

// Install synchronously so MAIN-world scripts can fire requests immediately
// — the recorder's first bridge call happens shortly after document_start.
installCompanionBridge();
startContextWatchdog();
