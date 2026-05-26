// karabuddy.replays.Footer — floating launcher + expanding panel.
//
// Post-B20 the in-page surface collapses to a single draggable button that
// only appears once the recorder has seen a gamestate this match. Clicking
// it expands a small floating panel anchored to the launcher's bounding
// rect (with edge-detection so it never overflows the viewport). The panel
// holds the REC indicator + event count, a prominent "+ Tag this moment"
// affordance, the most-recent-5 tags, and a hidden-until-resolved
// "Open this replay on karabuddy →" link.
//
// Module identities preserved from earlier versions:
//   - #karabast-replays-launcher  — the draggable button. 07-toast.js reads
//     this element's getBoundingClientRect() to anchor pills, so we never
//     recreate it; expand/collapse toggles a class instead.
//   - NS.Footer.{refreshOverlay,updateOverlay,refreshFooter} — Recorder
//     calls these on every event; we route them all to the same repaint.
(() => {
    const NS = ((window.__KaraBuddy ||= {}).replays ||= {});
    const R = () => NS.Recorder;
    const B = () => NS.bridge;
    const D = () => NS.Decoder;

    // ----- Layout constants -----
    const LAUNCHER_SIZE = 42;
    const LAUNCHER_POS_STORAGE_KEY = 'karabuddyLauncherPos';
    const LAUNCHER_DRAG_THRESHOLD = 4; // pixels of total movement before click → drag

    const PANEL_ID = 'karabast-replays-panel';
    const PANEL_WIDTH = 300;
    const PANEL_HEIGHT_ESTIMATE = 340; // for edge-detection — actual height clamped by content
    const PANEL_GAP = 8;               // space between launcher and panel
    const RECENT_TAGS_MAX = 5;

    // ----- Page-level styles (animations only — everything else is inline). -----
    const installFooterStyles = () => {
        if (document.getElementById('karabast-replays-frame-styles')) return;
        const style = document.createElement('style');
        style.id = 'karabast-replays-frame-styles';
        style.textContent = `
            @keyframes karabast-rec-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.35; }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    };

    // installFrame is a no-op post-B20 — the playback frame wrapper went with
    // 04-playback.js. Kept as an exported function so 06-bootstrap.js doesn't
    // need conditional plumbing if a future feature wants it back.
    const installFrame = () => {};

    // ----- Launcher (draggable, click → toggle panel) -----
    const clampLauncherPos = (x, y) => {
        const maxX = Math.max(0, window.innerWidth - LAUNCHER_SIZE);
        const maxY = Math.max(0, window.innerHeight - LAUNCHER_SIZE);
        return {
            x: Math.min(Math.max(0, x), maxX),
            y: Math.min(Math.max(0, y), maxY)
        };
    };

    const applyLauncherPos = (b, x, y) => {
        const { x: cx, y: cy } = clampLauncherPos(x, y);
        b.style.left = cx + 'px';
        b.style.top = cy + 'px';
    };

    const buildLauncher = () => {
        const b = document.createElement('button');
        b.id = 'karabast-replays-launcher';
        b.type = 'button';
        b.title = 'Open KaraBuddy (drag to move)';
        b.setAttribute('style', [
            'position: fixed',
            'top: 10px',
            'left: 10px',
            'z-index: 2147483646',
            'min-width: ' + LAUNCHER_SIZE + 'px',
            'height: ' + LAUNCHER_SIZE + 'px',
            'padding: 0 10px',
            'border-radius: 10px',
            'background: linear-gradient(140deg, #243044 0%, #1a1d23 100%)',
            'border: 1px solid rgba(74, 124, 255, 0.5)',
            'cursor: grab',
            'box-shadow: 0 2px 12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0,0,0,0.3)',
            // Default hidden — refreshFooter() flips to flex when recording
            // is active. The launcher has zero karabast.net footprint until
            // capture begins.
            'display: none',
            'align-items: center',
            'gap: 8px',
            'transition: transform 120ms ease, border-color 120ms ease, opacity 200ms ease',
            'touch-action: none',
            'opacity: 1'
        ].join(';'));
        b.addEventListener('mouseenter', () => {
            b.style.transform = 'scale(1.06)';
            b.style.borderColor = 'rgba(90, 140, 255, 0.85)';
        });
        b.addEventListener('mouseleave', () => {
            b.style.transform = '';
            b.style.borderColor = 'rgba(74, 124, 255, 0.5)';
        });

        // Restore persisted position. chrome.storage.local is async, so the
        // launcher initially renders at the default top:10/left:10 and
        // snaps to the stored position on the next frame.
        try {
            chrome.storage.local.get([LAUNCHER_POS_STORAGE_KEY], (res) => {
                const pos = res && res[LAUNCHER_POS_STORAGE_KEY];
                if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
                    applyLauncherPos(b, pos.x, pos.y);
                }
            });
        } catch {}

        // Drag state: track total movement so we can distinguish click vs drag.
        // While the panel is expanded we disable drag entirely — the panel is
        // visually attached to the launcher and dragging would force a tricky
        // reflow mid-gesture. Collapse first, then drag.
        let launcherDrag = null;
        const onMove = (e) => {
            if (!launcherDrag) return;
            const dx = e.clientX - launcherDrag.startX;
            const dy = e.clientY - launcherDrag.startY;
            launcherDrag.moved = Math.max(launcherDrag.moved, Math.hypot(dx, dy));
            if (launcherDrag.moved >= LAUNCHER_DRAG_THRESHOLD) {
                launcherDrag.dragging = true;
                b.style.cursor = 'grabbing';
            }
            if (launcherDrag.dragging) {
                applyLauncherPos(b, launcherDrag.startLeft + dx, launcherDrag.startTop + dy);
            }
        };
        const onUp = () => {
            if (!launcherDrag) return;
            const wasDrag = launcherDrag.dragging;
            launcherDrag = null;
            b.style.cursor = 'grab';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (wasDrag) {
                const rect = b.getBoundingClientRect();
                try {
                    chrome.storage.local.set({
                        [LAUNCHER_POS_STORAGE_KEY]: { x: rect.left, y: rect.top }
                    });
                } catch {}
            } else {
                togglePanel();
            }
        };
        b.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            // While expanded the launcher is "inside" the panel anchor — a
            // drag would feel broken (panel detaches mid-gesture). Pressing
            // the launcher while expanded is also the intended way to close.
            // Treat mousedown as a no-op for drag and let the panel's
            // outside-mousedown handler close it.
            if (panelOpen) return;
            e.preventDefault();
            const rect = b.getBoundingClientRect();
            launcherDrag = {
                startX: e.clientX,
                startY: e.clientY,
                startLeft: rect.left,
                startTop: rect.top,
                moved: 0,
                dragging: false
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });

        // Tiny stacked KARA/buddy mark, same DNA as the old sidebar header.
        const mono = document.createElement('span');
        mono.setAttribute('style', [
            'display: flex',
            'flex-direction: column',
            'align-items: flex-start',
            'line-height: 0.95',
            'padding: 0 2px',
            'flex: 0 0 auto'
        ].join(';'));

        const monoMain = document.createElement('span');
        monoMain.setAttribute('style', [
            'font: 400 12px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif',
            'color: #ffffff',
            'letter-spacing: 0',
            'text-transform: uppercase'
        ].join(';'));
        monoMain.textContent = 'KARA';

        const monoSub = document.createElement('span');
        monoSub.setAttribute('style', [
            'font: italic 700 10px Georgia, "Times New Roman", serif',
            'color: #5a8cff',
            'letter-spacing: -0.01em',
            'margin-left: 6px',
            'margin-top: -1px'
        ].join(';'));
        monoSub.textContent = 'buddy';

        mono.appendChild(monoMain);
        mono.appendChild(monoSub);

        // Inline REC indicator: pulsing dot + event count. The launcher is
        // only visible while recording, so this is always meaningful when
        // shown. Count updates via refreshFooter() on every recorder event.
        const recWrap = document.createElement('span');
        recWrap.id = 'karabast-replays-launcher-rec';
        recWrap.setAttribute('style', [
            'display: flex',
            'align-items: center',
            'gap: 6px',
            'padding-left: 6px',
            'border-left: 1px solid rgba(255,255,255,0.12)',
            'flex: 0 0 auto'
        ].join(';'));
        const recDot = document.createElement('span');
        recDot.setAttribute('style', [
            'display: inline-block',
            'width: 8px',
            'height: 8px',
            'border-radius: 50%',
            'background: #ff4040',
            'box-shadow: 0 0 6px #ff4040',
            'animation: karabast-rec-pulse 1.4s ease-in-out infinite'
        ].join(';'));
        const recCount = document.createElement('span');
        recCount.id = 'karabast-replays-launcher-rec-count';
        recCount.setAttribute('style', [
            'font: 600 11px -apple-system, BlinkMacSystemFont, sans-serif',
            'color: #d6e7ff',
            'letter-spacing: 0.04em'
        ].join(';'));
        recCount.textContent = 'REC';
        recWrap.appendChild(recDot);
        recWrap.appendChild(recCount);

        b.appendChild(mono);
        b.appendChild(recWrap);

        // Suppress any synthetic click after a drag (defensive — open is in
        // the mouseup handler above).
        b.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        return b;
    };

    // ----- Expanding panel (anchored to launcher; built fresh on each open) -----
    let panelOpen = false;
    let outsideMousedownHandler = null;

    // Position the panel relative to the launcher's bounding rect. Opens
    // rightward + downward by default; if the launcher is within
    // PANEL_WIDTH+gap of the viewport's right edge, opens leftward instead.
    // Same for vertical with PANEL_HEIGHT_ESTIMATE+gap and the bottom edge.
    // Final position is clamped to keep the panel fully on-screen.
    const positionPanel = (panel, launcher) => {
        const rect = launcher.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const openLeft = (vw - rect.right) < (PANEL_WIDTH + PANEL_GAP);
        const openUp = (vh - rect.bottom) < (PANEL_HEIGHT_ESTIMATE + PANEL_GAP);

        let left = openLeft
            ? rect.left - PANEL_WIDTH - PANEL_GAP
            : rect.right + PANEL_GAP;
        let top = openUp
            ? rect.bottom - PANEL_HEIGHT_ESTIMATE
            : rect.top;

        // Clamp so the panel never bleeds off screen.
        left = Math.max(8, Math.min(vw - PANEL_WIDTH - 8, left));
        top = Math.max(8, Math.min(vh - 60, top)); // leave ~60px of slack for shorter panels

        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
    };

    const buildPanel = () => {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.setAttribute('style', [
            'position: fixed',
            'z-index: 2147483646',
            'width: ' + PANEL_WIDTH + 'px',
            'max-height: 80vh',
            'overflow-y: auto',
            'background: rgba(17, 20, 26, 0.97)',
            'border: 1px solid rgba(74, 124, 255, 0.5)',
            'border-radius: 10px',
            'box-shadow: 0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.3)',
            'color: #e6e6e6',
            'font: 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'padding: 14px 14px 12px',
            'display: flex',
            'flex-direction: column',
            'gap: 12px',
            'user-select: none'
        ].join(';'));

        // Header row: REC dot + count, × dismiss.
        const headerRow = document.createElement('div');
        headerRow.setAttribute('style', 'display: flex; align-items: center; gap: 10px;');

        const headerStatus = document.createElement('div');
        headerStatus.setAttribute('style', 'display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0;');
        const headerDot = document.createElement('span');
        headerDot.setAttribute('style', [
            'display: inline-block',
            'width: 10px',
            'height: 10px',
            'border-radius: 50%',
            'background: #ff4040',
            'box-shadow: 0 0 6px #ff4040',
            'animation: karabast-rec-pulse 1.4s ease-in-out infinite',
            'flex: 0 0 auto'
        ].join(';'));
        const headerLabel = document.createElement('span');
        headerLabel.id = 'karabast-replays-panel-rec-label';
        headerLabel.setAttribute('style', 'font: 700 13px -apple-system, BlinkMacSystemFont, sans-serif; color: #fff; letter-spacing: 0.04em;');
        headerLabel.textContent = 'REC';
        headerStatus.appendChild(headerDot);
        headerStatus.appendChild(headerLabel);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.title = 'Close panel';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('style', [
            'background: transparent',
            'color: #a0a8b8',
            'border: 0',
            'padding: 0',
            'width: 22px',
            'height: 22px',
            'font: 18px -apple-system, BlinkMacSystemFont, sans-serif',
            'line-height: 1',
            'cursor: pointer',
            'border-radius: 4px',
            'flex: 0 0 auto'
        ].join(';'));
        closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#e6e6e6'; });
        closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#a0a8b8'; });
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closePanel();
        });

        headerRow.appendChild(headerStatus);
        headerRow.appendChild(closeBtn);

        // Auto-upload hint (replaces the old sidebar's recHint).
        const recHint = document.createElement('div');
        recHint.setAttribute('style', 'font-size: 11px; color: #6c7588; line-height: 1.4;');
        recHint.textContent = 'Saves automatically and uploads to karabuddy when the game ends.';

        // "+ Tag this moment" — toggles an inline textarea + Save/Cancel.
        const tagBlock = buildTagBlock();

        // Recent tags list (top 5 most recent).
        const recentSection = document.createElement('div');
        recentSection.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px;');
        const recentLabel = document.createElement('div');
        recentLabel.setAttribute('style', 'font: 600 10px -apple-system, BlinkMacSystemFont, sans-serif; color: #6c7588; letter-spacing: 0.08em; text-transform: uppercase;');
        recentLabel.textContent = 'Recent tags';
        const recentList = document.createElement('div');
        recentList.id = 'karabast-replays-panel-recent-list';
        recentList.setAttribute('style', 'display: flex; flex-direction: column; gap: 4px;');
        recentSection.appendChild(recentLabel);
        recentSection.appendChild(recentList);

        // "Open this replay on karabuddy →" link — hidden until the
        // recorder reports a URL (post-upload).
        const openLink = document.createElement('a');
        openLink.id = 'karabast-replays-panel-open-link';
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        openLink.textContent = 'Open this replay on karabuddy →';
        openLink.setAttribute('style', [
            'display: none',
            'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'color: #5da9ff',
            'text-decoration: none',
            'padding: 6px 0 0',
            'border-top: 1px solid #2e333c'
        ].join(';'));

        panel.appendChild(headerRow);
        panel.appendChild(recHint);
        panel.appendChild(tagBlock);
        panel.appendChild(recentSection);
        panel.appendChild(openLink);
        return panel;
    };

    // Compact tag block: button toggles a textarea + Save/Cancel inline.
    const buildTagBlock = () => {
        const wrap = document.createElement('div');
        wrap.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px;');

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = '+ Tag this moment';
        addBtn.setAttribute('style', [
            'background: rgba(74, 124, 255, 0.18)',
            'color: #d6e7ff',
            'border: 1px solid #4a7cff',
            'border-radius: 6px',
            'padding: 10px 14px',
            'font: 600 13px -apple-system, BlinkMacSystemFont, sans-serif',
            'cursor: pointer',
            'align-self: stretch'
        ].join(';'));

        const form = document.createElement('div');
        form.setAttribute('style', [
            'display: none',
            'flex-direction: column',
            'gap: 6px',
            'padding: 8px',
            'background: rgba(74, 124, 255, 0.08)',
            'border: 1px solid rgba(74, 124, 255, 0.3)',
            'border-radius: 6px'
        ].join(';'));

        const input = document.createElement('textarea');
        input.placeholder = 'Optional comment for this moment…';
        input.rows = 2;
        input.setAttribute('style', [
            'background: #11141a',
            'color: #e6e6e6',
            'border: 1px solid #2e333c',
            'border-radius: 4px',
            'padding: 6px 8px',
            'font: 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'resize: vertical',
            'outline: none',
            'min-height: 50px'
        ].join(';'));

        const openForm = () => {
            form.style.display = 'flex';
            input.value = '';
            setTimeout(() => input.focus(), 0);
        };
        const closeForm = () => { form.style.display = 'none'; };

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (form.style.display === 'none' || !form.style.display) openForm();
            else closeForm();
        });

        input.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                R().addTag(input.value.trim());
                closeForm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeForm();
            }
        });

        const btnRow = document.createElement('div');
        btnRow.setAttribute('style', 'display: flex; gap: 6px; align-self: flex-end;');
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.setAttribute('style', [
            'background: transparent',
            'color: #a0a8b8',
            'border: 1px solid #4a4e56',
            'border-radius: 4px',
            'padding: 3px 8px',
            'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'cursor: pointer'
        ].join(';'));
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeForm();
        });
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.textContent = 'Save tag';
        saveBtn.setAttribute('style', [
            'background: #4a7cff',
            'color: #fff',
            'border: 0',
            'border-radius: 4px',
            'padding: 3px 8px',
            'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'cursor: pointer'
        ].join(';'));
        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            R().addTag(input.value.trim());
            closeForm();
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        form.appendChild(input);
        form.appendChild(btnRow);

        wrap.appendChild(addBtn);
        wrap.appendChild(form);
        return wrap;
    };

    // Repaint the recent-tags list — most recent first, limited to 5.
    const renderRecentTags = (listEl) => {
        if (!listEl) return;
        listEl.innerHTML = '';
        const tags = R().getTags();
        if (!tags || tags.length === 0) {
            const empty = document.createElement('div');
            empty.setAttribute('style', 'font-size: 11px; color: #6c7588; font-style: italic; padding: 2px 0;');
            empty.textContent = 'No tags yet.';
            listEl.appendChild(empty);
            return;
        }
        const playerUsernames = R().getPlayerUsernames();
        const sorted = [...tags]
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, RECENT_TAGS_MAX);
        for (const tag of sorted) {
            const row = document.createElement('div');
            const color = D().playerColorFor(tag.author, playerUsernames);
            row.setAttribute('style', [
                'display: flex',
                'flex-direction: column',
                'gap: 2px',
                'padding: 5px 7px',
                'border-radius: 4px',
                'background: rgba(255, 255, 255, 0.025)',
                'border-left: 3px solid ' + color
            ].join(';'));

            const head = document.createElement('div');
            head.setAttribute('style', 'display: flex; align-items: center; gap: 8px; font-size: 10px; color: #a0a8b8;');
            const author = document.createElement('span');
            author.setAttribute('style', `color: ${color}; font-weight: 600;`);
            author.textContent = tag.author;
            const sep = document.createElement('span');
            sep.textContent = '·';
            sep.style.color = '#4a4e56';
            const frameRef = document.createElement('span');
            frameRef.textContent = `frame ${tag.frameIndex + 1}`;
            head.appendChild(author);
            head.appendChild(sep);
            head.appendChild(frameRef);

            const comment = document.createElement('div');
            comment.setAttribute('style', 'font-size: 11px; color: #d6d6d6; line-height: 1.3; word-wrap: break-word; white-space: pre-wrap;');
            comment.textContent = tag.comment || '(no comment)';
            if (!tag.comment) comment.style.color = '#6c7588';

            row.appendChild(head);
            row.appendChild(comment);
            listEl.appendChild(row);
        }
    };

    const openPanel = () => {
        if (panelOpen) return;
        const launcher = document.getElementById('karabast-replays-launcher');
        if (!launcher) return;
        const panel = buildPanel();
        document.body.appendChild(panel);
        positionPanel(panel, launcher);
        panelOpen = true;
        refreshFooter();

        // Outside-mousedown closes (use mousedown so the form's textarea
        // doesn't lose focus before its blur handlers fire normally). Ignore
        // events inside the panel and on the launcher itself (the launcher's
        // own mousedown handler is the canonical toggle path).
        outsideMousedownHandler = (e) => {
            const target = e.target;
            if (panel.contains(target)) return;
            if (launcher.contains(target)) return;
            closePanel();
        };
        // Defer attach by a frame so the click that opened us doesn't
        // immediately close us.
        setTimeout(() => {
            window.addEventListener('mousedown', outsideMousedownHandler, true);
        }, 0);
    };

    const closePanel = () => {
        if (!panelOpen) return;
        const panel = document.getElementById(PANEL_ID);
        if (panel) panel.remove();
        panelOpen = false;
        if (outsideMousedownHandler) {
            window.removeEventListener('mousedown', outsideMousedownHandler, true);
            outsideMousedownHandler = null;
        }
    };

    const togglePanel = () => {
        if (panelOpen) closePanel();
        else openPanel();
    };

    // ----- Mount + state-aware refresh -----
    const installFooter = () => {
        if (!document.body) return;
        if (document.getElementById('karabast-replays-launcher')) return;
        document.body.appendChild(buildLauncher());
        refreshFooter();
    };

    const isRecordingActive = () => {
        const r = R();
        if (!r) return false;
        return typeof r.isRecordingActive === 'function'
            ? r.isRecordingActive()
            : r.getRecordingLength() > 0;
    };

    const refreshFooter = () => {
        const launcher = document.getElementById('karabast-replays-launcher');
        if (!launcher) return;
        const active = isRecordingActive();

        // Launcher visibility: hidden until the recorder has captured at
        // least one gamestate for this session, then revealed (the toast at
        // the same moment tells the user what just happened).
        launcher.style.display = active ? 'inline-flex' : 'none';

        // If recording stopped while the panel was open (e.g. a match ended),
        // collapse the panel — there's no anchor anymore.
        if (!active && panelOpen) closePanel();

        // Live REC count in the launcher.
        const countEl = document.getElementById('karabast-replays-launcher-rec-count');
        if (countEl) countEl.textContent = `REC · ${R().getRecordingLength()}`;

        // Panel content (only if open).
        if (panelOpen) {
            const recLabel = document.getElementById('karabast-replays-panel-rec-label');
            if (recLabel) recLabel.textContent = `REC · ${R().getRecordingLength()} events`;

            const recentList = document.getElementById('karabast-replays-panel-recent-list');
            renderRecentTags(recentList);

            const openLink = document.getElementById('karabast-replays-panel-open-link');
            if (openLink) {
                const url = R().getCurrentKarabuddyUrl?.();
                if (url) {
                    openLink.href = url;
                    openLink.style.display = 'inline-block';
                } else {
                    openLink.style.display = 'none';
                }
            }
        }
    };

    NS.Footer = {
        installFooterStyles,
        installFrame,
        installFooter,
        refreshFooter,
        // Aliases — Recorder calls refreshOverlay/updateOverlay.
        refreshOverlay: refreshFooter,
        updateOverlay: refreshFooter,
        // Predicate kept for symmetry with the old API; nothing currently
        // reads it, but 07-toast.js's "is sidebar open?" check used to.
        // After B20 there's no sidebar — toast suppression is no longer
        // wanted (panel is hidden 99% of the time).
        isPanelOpen: () => panelOpen
    };
})();
