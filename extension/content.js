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

const installCompanionBridge = () => {
    window.addEventListener('karabast-companion-action', (e) => {
        const detail = e.detail || {};
        const correlationId = detail._id;
        const { _id, ...payload } = detail;
        const dispatchResult = (ok, error, data) => {
            window.dispatchEvent(new CustomEvent('karabast-companion-result', {
                detail: { _id: correlationId, type: detail.type, ok, error, data }
            }));
        };
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
