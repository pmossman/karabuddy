// karabuddy.replays.toast — launcher-anchored toast notifications.
//
// When status changes happen in the background (recording started, tag saved,
// upload succeeded/failed, replay saved) the user has no feedback unless the
// panel is open. This module renders a small pill that emerges from the
// right edge of the launcher button, holds briefly, then fades out. Multiple
// toasts stack vertically with the newest on top, older pushed down.
//
// Triggers wired into existing code paths:
//   - Recording started (first gamestate)    → "Recording…"        (info)
//   - Tag added (recording)                  → "Tag saved"         (success)
//   - Upload to karabuddy succeeded          → "Replay uploaded"   (success)
//   - Upload to karabuddy failed             → "Upload failed"     (error)
//   - Replay finalized + saved to IDB        → "Replay saved"      (success)
//
// Post-B20: the always-visible sidebar is gone — the launcher only appears
// while recording, and the expanding panel is dismissed by default. Toasts
// are now the primary out-of-band feedback channel and no longer suppressed.
(() => {
    const NS = ((window.__KaraBuddy ||= {}).replays ||= {});

    const CONTAINER_ID = 'karabast-replays-toast-stack';
    const LAUNCHER_ID = 'karabast-replays-launcher';
    const LAUNCHER_FALLBACK_SIZE = 28; // mirrors 05-footer.js LAUNCHER_MIN_HEIGHT
    const GAP = 6;             // vertical space between stacked toasts
    const ANCHOR_OFFSET = 18;  // horizontal gap between launcher edge and pill
    const DEFAULT_DURATION_MS = 3000;
    const ANIM_MS = 150;

    const COLORS = {
        info:    { dot: '#5da9ff', border: 'rgba(74, 124, 255, 0.55)' },
        success: { dot: '#4ade80', border: 'rgba(74, 222, 128, 0.55)' },
        error:   { dot: '#ff6b6b', border: 'rgba(255, 107, 107, 0.55)' }
    };

    const ensureContainer = () => {
        let c = document.getElementById(CONTAINER_ID);
        if (c) return c;
        c = document.createElement('div');
        c.id = CONTAINER_ID;
        c.setAttribute('style', [
            'position: fixed',
            'z-index: 2147483647',
            'pointer-events: none',
            'display: flex',
            'flex-direction: column-reverse', // newest on top of stack
            'align-items: flex-start',
            'gap: ' + GAP + 'px'
        ].join(';'));
        document.body.appendChild(c);
        return c;
    };

    // Position the stack container relative to the launcher's current
    // bounding rect (launcher is draggable per B16). Falls back to a sane
    // default if the launcher isn't in the DOM yet.
    const positionContainer = (c) => {
        const launcher = document.getElementById(LAUNCHER_ID);
        const size = LAUNCHER_FALLBACK_SIZE;
        let rect;
        if (launcher) {
            rect = launcher.getBoundingClientRect();
        } else {
            rect = { left: 10, top: 10, right: 10 + size, bottom: 10 + size, width: size, height: size };
        }
        // Anchor: pill emerges from the right edge of the launcher, vertically
        // centered. The container is positioned at the launcher's center Y
        // and we use translateY(-50%) on the stack to recentre it.
        c.style.left = (rect.right + ANCHOR_OFFSET) + 'px';
        c.style.top = (rect.top + rect.height / 2) + 'px';
        c.style.transform = 'translateY(-50%)';
    };

    const makePill = (text, kind, tooltip) => {
        const colors = COLORS[kind] || COLORS.info;
        const pill = document.createElement('div');
        pill.setAttribute('style', [
            'min-width: 200px',
            'max-width: 260px',
            'padding: 8px 12px',
            'border-radius: 999px',
            'background: linear-gradient(140deg, #243044 0%, #1a1d23 100%)',
            'border: 1px solid ' + colors.border,
            'box-shadow: 0 2px 12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0,0,0,0.3)',
            'color: #e6e6e6',
            'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'display: flex',
            'align-items: center',
            'gap: 8px',
            'white-space: nowrap',
            'overflow: hidden',
            'text-overflow: ellipsis',
            'opacity: 0',
            'transform: translateX(-8px)',
            'transition: opacity ' + ANIM_MS + 'ms ease, transform ' + ANIM_MS + 'ms ease',
            'pointer-events: ' + (tooltip ? 'auto' : 'none')
        ].join(';'));
        if (tooltip) pill.title = tooltip;

        const dot = document.createElement('span');
        dot.setAttribute('style', [
            'display: inline-block',
            'flex: 0 0 auto',
            'width: 8px',
            'height: 8px',
            'border-radius: 50%',
            'background: ' + colors.dot,
            'box-shadow: 0 0 6px ' + colors.dot
        ].join(';'));

        const label = document.createElement('span');
        label.setAttribute('style', 'overflow: hidden; text-overflow: ellipsis;');
        label.textContent = text;

        pill.appendChild(dot);
        pill.appendChild(label);
        return pill;
    };

    // show(text, opts?) — opts: { kind: 'info'|'success'|'error', durationMs, tooltip }
    const show = (text, opts = {}) => {
        try {
            const kind = opts.kind || 'info';
            const duration = Number.isFinite(opts.durationMs) ? opts.durationMs : DEFAULT_DURATION_MS;
            const tooltip = opts.tooltip || null;
            const container = ensureContainer();
            positionContainer(container); // initial best-effort position
            const pill = makePill(text, kind, tooltip);
            container.appendChild(pill);
            // Reposition in next frame: the caller (recorder) typically fires
            // T().show() BEFORE Footer.refreshOverlay(), so the launcher's
            // bounding rect at sync-call time doesn't yet include any width
            // changes from the same event (e.g. the REC indicator appearing
            // on first gamestate widens the launcher). By next rAF, all sync
            // refresh work has completed and the rect is settled.
            requestAnimationFrame(() => {
                positionContainer(container);
                pill.style.opacity = '1';
                pill.style.transform = 'translateX(0)';
            });
            setTimeout(() => {
                pill.style.opacity = '0';
                pill.style.transform = 'translateX(-8px)';
                setTimeout(() => {
                    pill.remove();
                    // If the stack is empty after removal, clean up the
                    // container so it doesn't sit around with stale geometry.
                    if (container.childElementCount === 0) container.remove();
                }, ANIM_MS + 20);
            }, duration);
        } catch (err) {
            console.error('[karabuddy] toast failed:', err);
        }
    };

    // Reposition the stack when the window resizes (launcher anchor moves).
    window.addEventListener('resize', () => {
        const c = document.getElementById(CONTAINER_ID);
        if (c) positionContainer(c);
    });

    NS.toast = { show };
})();
