// karabuddy.replays bootstrap — wires the modules together and starts.
//
// Loads last in the manifest's content_scripts.js array. All earlier files
// have attached their exports to NS.{Decoder,Recorder,Playback,Footer,bridge}
// by the time we run, so we can safely install handlers + kick off init.
(() => {
    const NS = ((window.__KaraBuddy ||= {}).replays ||= {});
    const { REPLAY_FLAG } = NS.flags;
    const { Decoder, Playback, Footer } = NS;
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
                const rs = Playback.replayState;
                if (isTextInputFocused()) return;
                if (e.metaKey || e.ctrlKey || e.altKey) return;

                // T → tag at the current moment. Works in both recording
                // and playback states; otherwise ignored.
                if ((e.key === 't' || e.key === 'T') && !e.shiftKey) {
                    if (rs.loaded) {
                        e.preventDefault();
                        Playback.addTag('');
                        return;
                    }
                    if (R() && R().getRecordingLength() > 0) {
                        e.preventDefault();
                        R().addTag('');
                        return;
                    }
                }

                // Tag navigation (playback only).
                if (rs.loaded) {
                    if (e.key === '[') {
                        e.preventDefault();
                        Playback.jumpToAdjacentTag(-1);
                        return;
                    }
                    if (e.key === ']') {
                        e.preventDefault();
                        Playback.jumpToAdjacentTag(1);
                        return;
                    }
                }

                if (!rs.loaded) return;
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    const otherMode = rs.mode === 'action' ? 'frame' : 'action';
                    Playback.advance(1, e.shiftKey ? otherMode : null);
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const otherMode = rs.mode === 'action' ? 'frame' : 'action';
                    Playback.advance(-1, e.shiftKey ? otherMode : null);
                } else if (e.key === 'Home') {
                    e.preventDefault();
                    Playback.jumpTo(0);
                } else if (e.key === 'End') {
                    e.preventDefault();
                    Playback.jumpTo(rs.frames.length - 1);
                }
            },
            true
        );
    };

    const installDropZone = () => {
        const isReplayFile = (f) =>
            f && (/\.karareplay$|\.json$/i.test(f.name) || f.type === 'application/json');

        const setDragVisual = (on) => {
            const el = document.getElementById('karabast-replays-footer');
            if (!el) return;
            el.style.outline = on ? '2px solid #4a7cff' : '';
            el.style.outlineOffset = on ? '-6px' : '';
        };

        let depth = 0;
        window.addEventListener('dragenter', (e) => {
            if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
            depth++;
            setDragVisual(true);
        });
        window.addEventListener('dragleave', () => {
            depth = Math.max(0, depth - 1);
            if (depth === 0) setDragVisual(false);
        });
        window.addEventListener('dragover', (e) => {
            if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        window.addEventListener('drop', (e) => {
            const files = Array.from(e.dataTransfer?.files || []);
            const replay = files.find(isReplayFile);
            if (!replay) return;
            e.preventDefault();
            depth = 0;
            setDragVisual(false);
            Playback.loadReplayFromFile(replay);
        });
    };

    const mountAndWatch = () => {
        installKeyHandlers();
        installDropZone();
        Decoder.installHiddenCardStyles();
        Footer.installFooterStyles();
        Footer.installFooter();
        Footer.installFrame();
        const observer = new MutationObserver(() => {
            Footer.installFooter();
            Footer.installFrame();
        });
        if (document.body) observer.observe(document.body, { childList: true });
        // Must run AFTER content.js has had a chance to attach its bridge
        // listener. content.js installs synchronously at script load, so by
        // DOMContentLoaded it's guaranteed to be ready. Firing earlier (at
        // script load) races the cross-world execution order: when MAIN-world
        // loads first, the dispatched event has no listener and times out.
        // (The fake transport at 04-playback.js's top-level still installs at
        // script-load — that part has to be early.)
        Playback.initReplayFromSession();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountAndWatch, { once: true });
    } else {
        mountAndWatch();
    }

    console.log('[karabuddy] loaded', REPLAY_FLAG ? '(playback mode)' : '');
})();
