// karabuddy.replays.Footer — floating launcher that grows in place.
//
// Single draggable element with two states:
//   - collapsed: header bar only (KARA/buddy mark + optional REC indicator);
//                cursor: grab; mousedown→drag, click→expand.
//   - expanded:  same header + body content underneath; the whole element
//                stays one DOM node, drag still works from the header.
//
// Body content branches on recording state at expand time:
//   - idle      → KaraBuddy links into karabuddy.app (replaces popup role)
//   - recording → REC + tag controls + recent tags + open-on-karabuddy link
//
// Edge-detection on expand: if the expanded element would overflow the
// viewport, we shift its top-left so it fits. The shift is not restored
// on collapse — the user accepted the new position (and can drag from
// there). Persistence happens only on user-initiated drags.
//
// Identities preserved for downstream consumers:
//   - #karabast-replays-launcher  — root container. 07-toast.js reads
//     this element's getBoundingClientRect() to anchor pills.
//   - NS.Footer.{refreshOverlay,updateOverlay,refreshFooter} — Recorder
//     calls these on every event; we route them all to the same repaint.
(() => {
    const NS = ((window.__KaraBuddy ||= {}).replays ||= {});
    const R = () => NS.Recorder;
    const B = () => NS.bridge;
    const D = () => NS.Decoder;

    // ----- Layout constants -----
    const LAUNCHER_ID = 'karabast-replays-launcher';
    const LAUNCHER_POS_STORAGE_KEY = 'karabuddyLauncherPos';
    const LAUNCHER_DRAG_THRESHOLD = 4; // pixels of total movement before click → drag
    const LAUNCHER_MIN_HEIGHT = 42;

    const EXPANDED_WIDTH = 300;
    const RECENT_TAGS_MAX = 5;
    const VIEWPORT_PADDING = 8;

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
    // 04-playback.js. Kept exported so 06-bootstrap.js doesn't need conditional
    // plumbing if a future feature wants it back.
    const installFrame = () => {};

    // ----- Position helpers -----
    const clampPos = (x, y, w, h) => {
        const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - w - VIEWPORT_PADDING);
        const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - h - VIEWPORT_PADDING);
        return {
            x: Math.min(Math.max(VIEWPORT_PADDING, x), maxX),
            y: Math.min(Math.max(VIEWPORT_PADDING, y), maxY)
        };
    };

    const applyPos = (el, x, y) => {
        const rect = el.getBoundingClientRect();
        const { x: cx, y: cy } = clampPos(x, y, rect.width, rect.height);
        el.style.left = cx + 'px';
        el.style.top = cy + 'px';
    };

    const isRecordingActive = () => {
        const r = R();
        if (!r) return false;
        return typeof r.isRecordingActive === 'function'
            ? r.isRecordingActive()
            : r.getRecordingLength() > 0;
    };

    // ----- State -----
    let expanded = false;
    let mode = null; // 'idle' | 'recording' when expanded
    let outsideMousedownHandler = null;

    // ----- Build the launcher (single root element with header + body) -----
    const buildLauncher = () => {
        const root = document.createElement('div');
        root.id = LAUNCHER_ID;
        root.setAttribute('style', [
            'position: fixed',
            'top: 10px',
            'left: 10px',
            'z-index: 2147483646',
            'min-height: ' + LAUNCHER_MIN_HEIGHT + 'px',
            'border-radius: 10px',
            'background: linear-gradient(140deg, #243044 0%, #1a1d23 100%)',
            'border: 1px solid rgba(74, 124, 255, 0.5)',
            'box-shadow: 0 2px 12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0,0,0,0.3)',
            'color: #e6e6e6',
            'font: 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'display: flex',
            'flex-direction: column',
            'overflow: hidden',
            'transition: width 140ms ease, border-color 120ms ease',
            'touch-action: none',
            'user-select: none'
        ].join(';'));

        // Restore persisted position.
        try {
            chrome.storage.local.get([LAUNCHER_POS_STORAGE_KEY], (res) => {
                const pos = res && res[LAUNCHER_POS_STORAGE_KEY];
                if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
                    applyPos(root, pos.x, pos.y);
                }
            });
        } catch {}

        root.appendChild(buildHeader(root));
        root.appendChild(buildBody());
        return root;
    };

    // Header bar: KARA/buddy lockup + REC indicator + (when expanded) × close.
    // Doubles as the drag handle and the click-to-toggle surface.
    const buildHeader = (root) => {
        const header = document.createElement('div');
        header.id = 'karabast-replays-launcher-header';
        header.setAttribute('style', [
            'display: flex',
            'align-items: center',
            'gap: 8px',
            'padding: 0 10px',
            'height: ' + LAUNCHER_MIN_HEIGHT + 'px',
            'flex: 0 0 auto',
            'cursor: grab'
        ].join(';'));

        header.addEventListener('mouseenter', () => {
            root.style.borderColor = 'rgba(90, 140, 255, 0.85)';
        });
        header.addEventListener('mouseleave', () => {
            root.style.borderColor = 'rgba(74, 124, 255, 0.5)';
        });

        // KARA/buddy stacked lockup.
        const mono = document.createElement('span');
        mono.setAttribute('style', [
            'display: flex',
            'flex-direction: column',
            'align-items: flex-start',
            'line-height: 0.95',
            'padding: 0 2px',
            'flex: 0 0 auto',
            'pointer-events: none'
        ].join(';'));
        const monoMain = document.createElement('span');
        monoMain.setAttribute('style', 'font: 400 12px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif; color: #fff; letter-spacing: 0; text-transform: uppercase;');
        monoMain.textContent = 'KARA';
        const monoSub = document.createElement('span');
        monoSub.setAttribute('style', 'font: italic 700 10px Georgia, "Times New Roman", serif; color: #5a8cff; letter-spacing: -0.01em; margin-left: 6px; margin-top: -1px;');
        monoSub.textContent = 'buddy';
        mono.appendChild(monoMain);
        mono.appendChild(monoSub);

        // REC indicator — hidden until recording, revealed by refreshFooter.
        const recWrap = document.createElement('span');
        recWrap.id = 'karabast-replays-launcher-rec';
        recWrap.setAttribute('style', [
            'display: none',
            'align-items: center',
            'gap: 6px',
            'padding-left: 6px',
            'border-left: 1px solid rgba(255,255,255,0.12)',
            'flex: 0 0 auto',
            'pointer-events: none'
        ].join(';'));
        const recDot = document.createElement('span');
        recDot.setAttribute('style', 'display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ff4040; box-shadow: 0 0 6px #ff4040; animation: karabast-rec-pulse 1.4s ease-in-out infinite;');
        const recCount = document.createElement('span');
        recCount.id = 'karabast-replays-launcher-rec-count';
        recCount.setAttribute('style', 'font: 600 11px -apple-system, BlinkMacSystemFont, sans-serif; color: #d6e7ff; letter-spacing: 0.04em;');
        recCount.textContent = 'REC';
        recWrap.appendChild(recDot);
        recWrap.appendChild(recCount);

        // Spacer pushes × to the right when expanded.
        const spacer = document.createElement('span');
        spacer.setAttribute('style', 'flex: 1 1 auto;');

        // × close button — hidden when collapsed.
        const closeBtn = document.createElement('button');
        closeBtn.id = 'karabast-replays-launcher-close';
        closeBtn.type = 'button';
        closeBtn.title = 'Collapse';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('style', [
            'display: none',
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
        closeBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            collapse();
        });

        header.appendChild(mono);
        header.appendChild(recWrap);
        header.appendChild(spacer);
        header.appendChild(closeBtn);

        // Drag + click handling on the header. Works in both collapsed and
        // expanded states — the whole launcher (header + body) moves together.
        attachDragAndToggle(header, root);

        return header;
    };

    // Body container — populated fresh on each expand, hidden when collapsed.
    const buildBody = () => {
        const body = document.createElement('div');
        body.id = 'karabast-replays-launcher-body';
        body.setAttribute('style', [
            'display: none',
            'flex-direction: column',
            'gap: 12px',
            'padding: 0 14px 12px',
            'max-height: calc(80vh - ' + LAUNCHER_MIN_HEIGHT + 'px)',
            'overflow-y: auto',
            'opacity: 0',
            'transition: opacity 140ms ease'
        ].join(';'));
        return body;
    };

    // ----- Drag + click-toggle on the header -----
    const attachDragAndToggle = (header, root) => {
        let drag = null;

        const onMove = (e) => {
            if (!drag) return;
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
            if (drag.moved >= LAUNCHER_DRAG_THRESHOLD) {
                drag.dragging = true;
                header.style.cursor = 'grabbing';
            }
            if (drag.dragging) {
                applyPos(root, drag.startLeft + dx, drag.startTop + dy);
            }
        };

        const onUp = () => {
            if (!drag) return;
            const wasDrag = drag.dragging;
            drag = null;
            header.style.cursor = 'grab';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (wasDrag) {
                const rect = root.getBoundingClientRect();
                try {
                    chrome.storage.local.set({
                        [LAUNCHER_POS_STORAGE_KEY]: { x: rect.left, y: rect.top }
                    });
                } catch {}
            } else {
                toggleExpanded();
            }
        };

        header.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            // Allow children with their own mousedown stopPropagation (e.g. ×
            // close button) to handle their own clicks without starting a
            // drag. Mousedowns that bubble here start the drag.
            e.preventDefault();
            const rect = root.getBoundingClientRect();
            drag = {
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
    };

    // ----- Expand / collapse -----
    const toggleExpanded = () => {
        if (expanded) collapse();
        else expand();
    };

    const expand = () => {
        if (expanded) return;
        const root = document.getElementById(LAUNCHER_ID);
        if (!root) return;
        const body = document.getElementById('karabast-replays-launcher-body');
        const closeBtn = document.getElementById('karabast-replays-launcher-close');
        if (!body) return;

        // Pre-expand: clear body, populate with current mode's content.
        const active = isRecordingActive();
        mode = active ? 'recording' : 'idle';
        body.replaceChildren(...(active ? buildRecordingBody() : buildIdleBody()));
        body.style.display = 'flex';
        if (closeBtn) closeBtn.style.display = 'inline-block';

        // Width snaps to EXPANDED_WIDTH; the CSS transition on width
        // animates the change for the eye even though the body fades in.
        root.style.width = EXPANDED_WIDTH + 'px';

        // After layout settles, fade in the body and edge-shift if needed.
        requestAnimationFrame(() => {
            body.style.opacity = '1';
            shiftToFit(root);
        });

        expanded = true;
        refreshFooter();

        // Outside-mousedown collapses. Defer attachment by a frame so the
        // click that opened us doesn't immediately close us.
        outsideMousedownHandler = (e) => {
            if (root.contains(e.target)) return;
            collapse();
        };
        setTimeout(() => {
            window.addEventListener('mousedown', outsideMousedownHandler, true);
        }, 0);
    };

    const collapse = () => {
        if (!expanded) return;
        const root = document.getElementById(LAUNCHER_ID);
        const body = document.getElementById('karabast-replays-launcher-body');
        const closeBtn = document.getElementById('karabast-replays-launcher-close');
        if (body) {
            body.style.opacity = '0';
            body.style.display = 'none';
            body.replaceChildren();
        }
        if (closeBtn) closeBtn.style.display = 'none';
        if (root) root.style.width = '';
        expanded = false;
        mode = null;
        if (outsideMousedownHandler) {
            window.removeEventListener('mousedown', outsideMousedownHandler, true);
            outsideMousedownHandler = null;
        }
    };

    // After expanding, if the launcher's bounding rect overflows the viewport,
    // shift its top-left to fit. Not persisted (drag is the only path that
    // updates the stored position).
    const shiftToFit = (root) => {
        const rect = root.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left = rect.left;
        let top = rect.top;
        if (rect.right > vw - VIEWPORT_PADDING) {
            left = Math.max(VIEWPORT_PADDING, vw - rect.width - VIEWPORT_PADDING);
        }
        if (rect.bottom > vh - VIEWPORT_PADDING) {
            top = Math.max(VIEWPORT_PADDING, vh - rect.height - VIEWPORT_PADDING);
        }
        if (left !== rect.left || top !== rect.top) {
            root.style.left = left + 'px';
            root.style.top = top + 'px';
        }
    };

    // ----- Body content builders -----
    const buildIdleBody = () => {
        const els = [];

        const hint = document.createElement('div');
        hint.setAttribute('style', 'font-size: 11px; color: #6c7588; line-height: 1.4; padding-top: 10px;');
        hint.textContent = 'Recording is automatic — start a match on karabast.net and the launcher will light up.';
        els.push(hint);

        const linksWrap = document.createElement('div');
        linksWrap.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px;');
        linksWrap.appendChild(makeLinkButton('My replays →', 'primary', () => {
            B().openReplays('mine').catch(() => {});
            collapse();
        }));
        linksWrap.appendChild(makeLinkButton('Browse public replays →', 'secondary', () => {
            B().openReplays('public').catch(() => {});
            collapse();
        }));
        els.push(linksWrap);

        return els;
    };

    const buildRecordingBody = () => {
        const els = [];

        // REC sub-header inside the body (the launcher's own header already
        // shows the small REC indicator; the body restates it as a label
        // with the "events" suffix so the count is obvious at a glance).
        const recBlock = document.createElement('div');
        recBlock.setAttribute('style', 'display: flex; align-items: center; gap: 8px; padding-top: 10px;');
        const recDot = document.createElement('span');
        recDot.setAttribute('style', 'display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #ff4040; box-shadow: 0 0 6px #ff4040; animation: karabast-rec-pulse 1.4s ease-in-out infinite; flex: 0 0 auto;');
        const recLabel = document.createElement('span');
        recLabel.id = 'karabast-replays-panel-rec-label';
        recLabel.setAttribute('style', 'font: 700 13px -apple-system, BlinkMacSystemFont, sans-serif; color: #fff; letter-spacing: 0.04em;');
        recLabel.textContent = 'REC';
        recBlock.appendChild(recDot);
        recBlock.appendChild(recLabel);
        els.push(recBlock);

        const hint = document.createElement('div');
        hint.setAttribute('style', 'font-size: 11px; color: #6c7588; line-height: 1.4;');
        hint.textContent = 'Saves automatically and uploads to karabuddy when the game ends.';
        els.push(hint);

        els.push(buildTagBlock());

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
        els.push(recentSection);

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
        // Anchor clicks shouldn't initiate drag.
        openLink.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        els.push(openLink);

        return els;
    };

    // Idle-mode link button.
    const makeLinkButton = (text, variant, onClick) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = text;
        const base = variant === 'primary'
            ? ['background: rgba(74, 124, 255, 0.18)', 'color: #d6e7ff', 'border: 1px solid #4a7cff']
            : ['background: transparent', 'color: #d6e7ff', 'border: 1px solid #2e333c'];
        btn.setAttribute('style', base.concat([
            'border-radius: 6px',
            'padding: 9px 12px',
            'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'cursor: pointer',
            'text-align: left'
        ]).join(';'));
        btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return btn;
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
        // Stop mousedown on input so textarea-drag-selection doesn't start a
        // launcher drag through the header handler.
        input.addEventListener('mousedown', (e) => { e.stopPropagation(); });

        const openForm = () => {
            form.style.display = 'flex';
            input.value = '';
            setTimeout(() => input.focus(), 0);
        };
        const closeForm = () => { form.style.display = 'none'; };

        addBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
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
        cancelBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
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
        saveBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
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

    // ----- Mount + state-aware refresh -----
    const installFooter = () => {
        if (!document.body) return;
        if (document.getElementById(LAUNCHER_ID)) return;
        document.body.appendChild(buildLauncher());
        refreshFooter();
    };

    const refreshFooter = () => {
        const launcher = document.getElementById(LAUNCHER_ID);
        if (!launcher) return;
        const active = isRecordingActive();

        // REC indicator in the header reveals only while capturing.
        const recBlock = document.getElementById('karabast-replays-launcher-rec');
        if (recBlock) recBlock.style.display = active ? 'flex' : 'none';

        // If the recording state flipped while expanded, the body content
        // (idle links vs recording controls) is now stale. Collapse so the
        // next user open rebuilds in the correct mode — the toast that fired
        // around the transition tells them what just happened.
        if (expanded && mode !== (active ? 'recording' : 'idle')) {
            collapse();
        }

        // Live REC count in the launcher header.
        const countEl = document.getElementById('karabast-replays-launcher-rec-count');
        if (countEl) countEl.textContent = `REC · ${R().getRecordingLength()}`;

        // Repaint body content for the recording mode (idle has no live data).
        if (expanded && mode === 'recording') {
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
        refreshOverlay: refreshFooter,
        updateOverlay: refreshFooter,
        isPanelOpen: () => expanded
    };
})();
