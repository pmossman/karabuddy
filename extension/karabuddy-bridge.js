// Content script that runs on karabuddy.com (and dev variants). Listens
// for the page asking for this install's karabuddy token, and replies
// via window.postMessage. Lets the /claim page auto-fill itself instead
// of making users hunt for an opaque token string.
//
// Security: this script runs ONLY on karabuddy origins per the manifest
// matches, so the message source is always trusted. The token grants
// ownership over replays/tags uploaded by this install — if a karabuddy
// page is compromised, the token leaks; that's the same blast radius
// as the user's signed-in karabuddy session, so no worse.

(() => {
    const PROTOCOL_VERSION = 1;

    window.addEventListener('message', async (e) => {
        if (e.source !== window) return;
        const data = e.data;
        if (!data || data.type !== 'karabuddy:requestInstallToken') return;
        try {
            let { karabuddyInstallToken: token } = await chrome.storage.local.get('karabuddyInstallToken');
            // Mint lazily: a fresh install on a new device has no token until
            // the first replay upload. Without this, asking the bridge before
            // recording any matches returns null and karabuddy.app's
            // AutoDetectExtension shows "couldn't detect" even though the
            // extension is fine. Generating here means the token always
            // exists from the moment any consumer asks for it.
            if (!token) {
                token = 'kbx_' + crypto.randomUUID();
                await chrome.storage.local.set({ karabuddyInstallToken: token });
            }
            window.postMessage({
                type: 'karabuddy:installTokenResponse',
                requestId: data.requestId,
                token,
                protocol: PROTOCOL_VERSION
            }, window.location.origin);
        } catch (err) {
            window.postMessage({
                type: 'karabuddy:installTokenResponse',
                requestId: data.requestId,
                token: null,
                error: String(err?.message || err),
                protocol: PROTOCOL_VERSION
            }, window.location.origin);
        }
    });
})();
