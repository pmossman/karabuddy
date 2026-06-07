// karabuddy.replays bootstrap — wires the modules together and starts.
//
// Loads last in the manifest's content_scripts.js array. All earlier files
// have attached their exports to NS.{Decoder,Recorder,Footer,bridge,toast}
// by the time we run, so we can safely install handlers + kick off init.
//
// Post-B20: in-place playback (04-playback.js) is gone — karabuddy.app owns
// the viewer now. Only the recorder + floating launcher live here.
(() => {
    const NS = ((window.__KaraBuddy ||= {}).replays ||= {});
    const { Decoder, Footer } = NS;
    const R = () => NS.Recorder;

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

    const installKeyHandlers = () => {
        window.addEventListener(
            'keydown',
            (e) => {
                if (isTextInputFocused()) return;
                if (e.metaKey || e.ctrlKey || e.altKey) return;

                // T → tag at the current moment, when recording is active.
                if ((e.key === 't' || e.key === 'T') && !e.shiftKey) {
                    if (R() && R().getRecordingLength() > 0) {
                        e.preventDefault();
                        R().addTag('');
                    }
                }
            },
            true
        );
    };

    // When the extension is reloaded or auto-updated, content.js can no
    // longer talk to the service worker — uploads, IDB saves, and the
    // bridge all silently fail until the user refreshes the tab. content.js
    // detects this and fires a sentinel CustomEvent; surface a persistent
    // dismissible toast so the user knows what to do. Also flip a flag
    // the recorder reads to suppress its noisy generic "Upload failed"
    // toast (the persistent one already explains why).
    const installContextInvalidatedHandler = () => {
        window.addEventListener('karabast-companion-context-invalidated', () => {
            NS.contextInvalidated = true;
            NS.toast?.show?.(
                'KaraBuddy was updated. Refresh this karabast.net tab to keep recording your matches.',
                { kind: 'warning', persistent: true, key: 'context-invalidated' }
            );
        });
    };

    // B72: ask the server whether this version is ok / should nag / is
    // blocked, and surface nag+block through the same persistent toast as
    // the "updated, refresh" notice. Best-effort: a null/failed check is
    // treated as ok (never brick on a transient error). The toast registry
    // collapses by key, so it won't stack on re-checks.
    const checkExtensionStatus = () => {
        if (!NS.bridge || !NS.bridge.getExtensionStatus) return;
        NS.bridge.getExtensionStatus().then((status) => {
            if (!status || !status.status) return;
            if (status.status === 'nag') {
                NS.toast?.show?.(
                    status.message || 'A new version of KaraBuddy is available — reload to update.',
                    { kind: 'warning', persistent: true, key: 'ext-status-nag' }
                );
            } else if (status.status === 'block') {
                NS.toast?.show?.(
                    status.message || 'This KaraBuddy version is out of date — please update to keep recording.',
                    { kind: 'error', persistent: true, key: 'ext-status-block' }
                );
            }
        }).catch(() => {});
    };

    // B111: karabast binds each user to a SINGLE game socket. Opening a second
    // karabast window — even just the home screen — makes karabast disconnect
    // the playing window's socket and rebind the lobby to the newest connection
    // (server: Lobby.checkUpdateSocket). The recorder is per-window, so it can't
    // capture a complete match while a second karabast window is open — the
    // stream gets yanked away mid-game. We can't change karabast, so warn the
    // user to close the extras. The SW counts karabast tabs; we re-check on
    // mount, on focus, and on a light interval, and clear the toast once only
    // one window remains.
    const MULTI_TAB_KEY = 'multi-tab';
    const checkMultiTab = async () => {
        try {
            const n = await NS.bridge?.getKarabastTabCount?.();
            if (typeof n !== 'number') return; // bridge unavailable — leave as-is
            if (n > 1) {
                NS.toast?.show?.(
                    'Multiple karabast tabs are open. Close the others — KaraBuddy can only record a match from a single karabast window.',
                    { kind: 'warning', persistent: true, key: MULTI_TAB_KEY }
                );
            } else {
                NS.toast?.dismiss?.(MULTI_TAB_KEY);
            }
        } catch {}
    };

    const mountAndWatch = () => {
        installKeyHandlers();
        installContextInvalidatedHandler();
        Decoder.installHiddenCardStyles();
        Footer.installFooterStyles();
        Footer.installFooter();
        checkExtensionStatus();
        checkMultiTab();
        // Re-check when the tab regains focus (the user just came back from the
        // other karabast window they opened) and periodically while visible (a
        // second window opened mid-game; the interval also clears the warning
        // once they close it). Gated on visibility so backgrounded tabs idle.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') checkMultiTab();
        });
        setInterval(() => { if (document.visibilityState === 'visible') checkMultiTab(); }, 12000);
        const observer = new MutationObserver(() => {
            Footer.installFooter();
        });
        if (document.body) observer.observe(document.body, { childList: true });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountAndWatch, { once: true });
    } else {
        mountAndWatch();
    }

    NS.dlog('[karabuddy:karabast] content scripts loaded on', window.location.href);
})();
