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
    // Debug logging — off in shipped builds. Toggle via the page-side
    // localStorage flag so a dev can flip it without touching extension
    // storage: `localStorage.karabuddyDebug = '1'` then reload.
    const DEBUG = (() => {
        try { return localStorage.getItem('karabuddyDebug') === '1'; }
        catch { return false; }
    })();
    const LOG = (...args) => { if (DEBUG) console.info('[karabuddy:bridge]', ...args); };
    LOG('loaded on', window.location.href);

    // Persist the page's origin as the SW endpoint. The bridge runs on
    // every karabuddy.app match in the manifest (prod, *.karabuddy.app,
    // *.vercel.app, http://localhost:3000) — whichever the user is
    // currently using is by definition the endpoint the SW should hit
    // for whoami / teams-mention-data / team-shares calls. Without this,
    // a dev user running localhost gets SW fetches against prod (where
    // their install token isn't linked) and the bubble silently shows
    // "Not signed in". Latest-visit wins; reverts cleanly when the user
    // hits prod again.
    (async () => {
        try {
            const origin = window.location.origin;
            const { karabuddyEndpoint: current } = await chrome.storage.local.get('karabuddyEndpoint');
            if (current !== origin) {
                await chrome.storage.local.set({ karabuddyEndpoint: origin });
                LOG('endpoint pinned to', origin);
            }
        } catch {}
    })();

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

    // B69b: do the link DIRECTLY from this content script instead of
    // relying on the React-side AutoClaim component to pick up a
    // postMessage and fetch. A content-script fetch to the same origin
    // sends the page's cookies (same-origin, no SameSite quirks), so we
    // can hit /api/me/claim straight from here. Removes the timing race
    // between bridge-mount, AutoClaim-mount, and session-cookie-set.
    //
    // Still postMessage the token + claim result so AutoClaim can show
    // the success toast — that's its remaining responsibility.
    (async () => {
        try {
            const token = await getOrMintToken();
            LOG('install token', token.slice(0, 12) + '…');

            // Announce the token first (Settings page + bubble both read
            // this to detect "which install is this browser").
            window.postMessage({
                type: 'karabuddy:availableInstallToken',
                token,
                protocol: PROTOCOL_VERSION
            }, window.location.origin);

            // Directly claim. Idempotent — server's onConflictDoUpdate
            // means re-firing every page load is harmless. 401 means
            // the user isn't signed in yet; retry on next page load.
            LOG('POST /api/me/claim');
            const res = await fetch('/api/me/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ token }),
            });
            LOG('claim response status', res.status);
            if (res.ok) {
                const body = await res.json().catch(() => null);
                LOG('claim body', body);
                if (body && body.ok) {
                    window.postMessage({
                        type: 'karabuddy:claimResult',
                        token,
                        claimedReplays: body.claimedReplays || 0,
                        claimedTags: body.claimedTags || 0,
                        protocol: PROTOCOL_VERSION,
                    }, window.location.origin);
                }
            } else if (res.status === 401) {
                LOG('claim 401 — user not signed in (yet). will retry on next page load.');
            } else {
                LOG('claim non-ok status', res.status, await res.text().catch(() => ''));
            }
        } catch (err) {
            LOG('claim failed:', err && err.message || err);
        }
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
