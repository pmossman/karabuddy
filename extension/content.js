// ISOLATED-world content script on karabast.net.
//
// Sole job: bridge MAIN-world dispatched events (from the replays content
// scripts) to the service worker via chrome.runtime.sendMessage, and surface
// the response back as a `karabast-companion-result` event with the same
// correlation id.
//
// MAIN world can't call chrome.runtime directly; this bridge is the only
// way the replay recorder + footer panel can talk to background.js.

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

// Install synchronously so MAIN-world scripts can fire requests immediately
// — the recorder's first bridge call happens shortly after document_start.
installCompanionBridge();
