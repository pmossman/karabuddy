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
        error:   { dot: '#ff6b6b', border: 'rgba(255, 107, 107, 0.55)' },
        warning: { dot: '#ffb454', border: 'rgba(255, 180, 84, 0.55)' }
    };

    // Persistent-toast registry — keyed by an opts.key string so callers can
    // ensure the same warning doesn't stack on every retry. show() with a
    // duplicate key collapses to a no-op while the existing toast is alive.
    const activePersistent = new Map();

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

    const makePill = (text, kind, tooltip, persistent) => {
        const colors = COLORS[kind] || COLORS.info;
        const interactive = persistent || tooltip;
        const pill = document.createElement('div');
        pill.setAttribute('style', [
            'min-width: 200px',
            'max-width: 320px',
            'padding: 8px ' + (persistent ? '6px' : '12px') + ' 8px 12px',
            'border-radius: ' + (persistent ? '12px' : '999px'),
            'background: linear-gradient(140deg, #243044 0%, #1a1d23 100%)',
            'border: 1px solid ' + colors.border,
            'box-shadow: 0 2px 12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0,0,0,0.3)',
            'color: #e6e6e6',
            'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'display: flex',
            'align-items: ' + (persistent ? 'flex-start' : 'center'),
            'gap: 8px',
            'white-space: ' + (persistent ? 'normal' : 'nowrap'),
            'line-height: ' + (persistent ? '1.4' : '1.2'),
            'overflow: hidden',
            'text-overflow: ellipsis',
            'opacity: 0',
            'transform: translateX(-8px)',
            'transition: opacity ' + ANIM_MS + 'ms ease, transform ' + ANIM_MS + 'ms ease',
            'pointer-events: ' + (interactive ? 'auto' : 'none')
        ].join(';'));
        if (tooltip) pill.title = tooltip;

        const dot = document.createElement('span');
        dot.setAttribute('style', [
            'display: inline-block',
            'flex: 0 0 auto',
            'width: 8px',
            'height: 8px',
            'margin-top: ' + (persistent ? '4px' : '0'),
            'border-radius: 50%',
            'background: ' + colors.dot,
            'box-shadow: 0 0 6px ' + colors.dot
        ].join(';'));

        const label = document.createElement('span');
        label.setAttribute('style', 'flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis;');
        label.textContent = text;

        pill.appendChild(dot);
        pill.appendChild(label);
        return pill;
    };

    // show(text, opts?) — opts:
    //   kind:       'info' | 'success' | 'error' | 'warning'
    //   durationMs: number — auto-hide after N ms (ignored if persistent)
    //   tooltip:    string — title attribute on the pill
    //   persistent: boolean — no auto-hide; renders an × close button
    //   key:        string — dedup key for persistent toasts; show() with the
    //               same key while one is alive is a no-op (prevents stacking
    //               duplicate context-invalidated warnings on every retry)
    const show = (text, opts = {}) => {
        try {
            const kind = opts.kind || 'info';
            const persistent = !!opts.persistent;
            const key = opts.key || null;
            // Dedup persistent toasts by key.
            if (persistent && key && activePersistent.has(key)) return;
            const duration = Number.isFinite(opts.durationMs) ? opts.durationMs : DEFAULT_DURATION_MS;
            const tooltip = opts.tooltip || null;
            const container = ensureContainer();
            positionContainer(container);
            const pill = makePill(text, kind, tooltip, persistent);
            container.appendChild(pill);

            const dismiss = () => {
                pill.style.opacity = '0';
                pill.style.transform = 'translateX(-8px)';
                setTimeout(() => {
                    pill.remove();
                    if (container.childElementCount === 0) container.remove();
                    if (persistent && key) activePersistent.delete(key);
                }, ANIM_MS + 20);
            };

            if (persistent) {
                const closeBtn = document.createElement('button');
                closeBtn.type = 'button';
                closeBtn.textContent = '×';
                closeBtn.title = 'Dismiss';
                closeBtn.setAttribute('style', [
                    'background: transparent',
                    'color: #a0a8b8',
                    'border: 0',
                    'padding: 0',
                    'width: 20px',
                    'height: 20px',
                    'font: 16px -apple-system, BlinkMacSystemFont, sans-serif',
                    'line-height: 1',
                    'cursor: pointer',
                    'border-radius: 4px',
                    'flex: 0 0 auto',
                    'margin-top: -1px'
                ].join(';'));
                closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#e6e6e6'; });
                closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#a0a8b8'; });
                closeBtn.addEventListener('click', dismiss);
                pill.appendChild(closeBtn);
                if (key) activePersistent.set(key, dismiss);
            }

            // Reposition + fade in next frame so launcher rect changes from
            // the same event loop have settled before we measure.
            requestAnimationFrame(() => {
                positionContainer(container);
                pill.style.opacity = '1';
                pill.style.transform = 'translateX(0)';
            });

            if (!persistent) setTimeout(dismiss, duration);
        } catch (err) {
            console.error('[karabuddy] toast failed:', err);
        }
    };

    // Programmatically dismiss a persistent toast by key. Used when the
    // condition that triggered it gets resolved (e.g. on next bridge success).
    const dismiss = (key) => {
        const fn = activePersistent.get(key);
        if (fn) fn();
    };

    // Reposition the stack when the window resizes (launcher anchor moves).
    window.addEventListener('resize', () => {
        const c = document.getElementById(CONTAINER_ID);
        if (c) positionContainer(c);
    });

    NS.toast = { show, dismiss };
})();
