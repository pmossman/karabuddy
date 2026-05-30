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

    // Get-or-mint the install token. Same as background.js's
    // getKarabuddyInstallToken but inlined here so the bridge can run
    // without bouncing through the SW.
    const getOrMintToken = async () => {
        let { karabuddyInstallToken: token } = await chrome.storage.local.get('karabuddyInstallToken');
        if (!token) {
            token = 'kbx_' + crypto.randomUUID();
            await chrome.storage.local.set({ karabuddyInstallToken: token });
        }
        return token;
    };

    // B68: PROACTIVE announcement. On every karabuddy.app page load,
    // post the install token immediately so AutoClaim doesn't have to
    // poll-with-timeout to discover it. The explicit request flow below
    // stays — handles the page-loads-before-bridge race the other way.
    (async () => {
        try {
            const token = await getOrMintToken();
            window.postMessage({
                type: 'karabuddy:availableInstallToken',
                token,
                protocol: PROTOCOL_VERSION
            }, window.location.origin);
        } catch {}
    })();

    window.addEventListener('message', async (e) => {
        if (e.source !== window) return;
        const data = e.data;
        if (!data || data.type !== 'karabuddy:requestInstallToken') return;
        try {
            const token = await getOrMintToken();
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
