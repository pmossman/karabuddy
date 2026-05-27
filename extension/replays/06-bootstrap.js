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

    const mountAndWatch = () => {
        installKeyHandlers();
        Decoder.installHiddenCardStyles();
        Footer.installFooterStyles();
        Footer.installFooter();
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

    NS.dlog('[karabuddy] loaded');
})();
