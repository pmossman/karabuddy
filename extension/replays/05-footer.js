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
    const LAUNCHER_MIN_HEIGHT = 28;

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

    // B67: persistent "share this match's replay with team(s)" selection.
    // Lives in chrome.storage.local so it survives reloads + applies to
    // every subsequent match until the user toggles it back off.
    //   karabuddyShareTeamSlugs:    string[]  active selection
    //   karabuddyLastShareTeamSlugs string[]  last non-empty selection;
    //                                          used to restore on toggle
    let shareTeamSlugs = [];
    let lastShareTeamSlugs = [];
    const SHARE_STORAGE_KEY = 'karabuddyShareTeamSlugs';
    const SHARE_LAST_STORAGE_KEY = 'karabuddyLastShareTeamSlugs';

    const loadShareState = () => {
        try {
            chrome.storage.local.get([SHARE_STORAGE_KEY, SHARE_LAST_STORAGE_KEY], (res) => {
                if (Array.isArray(res?.[SHARE_STORAGE_KEY])) shareTeamSlugs = res[SHARE_STORAGE_KEY];
                if (Array.isArray(res?.[SHARE_LAST_STORAGE_KEY])) lastShareTeamSlugs = res[SHARE_LAST_STORAGE_KEY];
                refreshFooter();
            });
        } catch {}
    };

    const persistShareState = () => {
        try {
            const payload = { [SHARE_STORAGE_KEY]: shareTeamSlugs };
            // Only update lastShareTeamSlugs when we have a non-empty
            // selection so toggling OFF doesn't wipe the restore target.
            if (shareTeamSlugs.length > 0) {
                lastShareTeamSlugs = [...shareTeamSlugs];
                payload[SHARE_LAST_STORAGE_KEY] = lastShareTeamSlugs;
            }
            chrome.storage.local.set(payload);
        } catch {}
    };

    // Public-ish accessor — the recorder reads this after every successful
    // upload to know which teams to apply shares for.
    const getShareTeamSlugs = () => [...shareTeamSlugs];

    // B69: cached signed-in account info. Loaded lazily on first expand
    // via the bridge → SW → /api/me/whoami path (install-token header
    // auth, so SameSite cookie quirks don't bite). 5-min TTL — fresh
    // enough to catch karabastUsername changes, stale enough not to
    // hammer the API.
    let whoamiCache = null;
    let whoamiLoadedAt = 0;
    let whoamiInflight = null;
    const WHOAMI_TTL_MS = 5 * 60 * 1000;
    const loadWhoami = async (force = false) => {
        if (!force && whoamiCache && Date.now() - whoamiLoadedAt < WHOAMI_TTL_MS) {
            return whoamiCache;
        }
        if (whoamiInflight) return whoamiInflight;
        whoamiInflight = (async () => {
            try {
                console.info('[karabuddy:karabast] bubble: fetching whoami via SW');
                const result = await B().getWhoami?.();
                console.info('[karabuddy:karabast] bubble: whoami result', result);
                // companionRequest already unwraps to `data` from the
                // SW response, so `result` IS the API body. Don't
                // double-unwrap.
                if (result && result.ok && result.user) {
                    whoamiCache = result.user;
                    whoamiLoadedAt = Date.now();
                    return whoamiCache;
                }
                whoamiCache = { displayName: null, signedOut: true };
                whoamiLoadedAt = Date.now();
                return whoamiCache;
            } catch (err) {
                console.warn('[karabuddy:karabast] bubble: whoami failed', err);
                return null;
            } finally {
                whoamiInflight = null;
            }
        })();
        return whoamiInflight;
    };

    // B69: open karabuddy sign-in in a popup window. Doesn't interrupt
    // the karabast match — the popup lives in its own window, the user
    // signs in (Discord/Google), karabuddy.app's ExtensionSigninReturn
    // component detects the `fromExtension=1` callback and closes the
    // popup. We poll popup.closed too in case the user closes manually.
    const openSigninPopup = async () => {
        const endpointResult = await B().getEndpoint?.();
        const endpoint = endpointResult?.endpoint || 'https://karabuddy.app';
        const callbackUrl = encodeURIComponent('/?fromExtension=1');
        const url = `${endpoint}/signin?callbackUrl=${callbackUrl}`;
        // 600x750 fits both Discord + Google's OAuth pages comfortably.
        const popup = window.open(url, 'karabuddy-signin', 'popup,width=600,height=750');
        if (!popup) {
            // Popup blocked — fall back to opening in a regular tab.
            window.open(url, '_blank');
            return;
        }
        // Two-track close detection so we always notice + refresh:
        //   1. postMessage from the karabuddy "you can close now" page
        //   2. polled popup.closed (handles manual close + cases where
        //      postMessage doesn't fire e.g. due to cross-origin blockers)
        const onSignedInMessage = (e) => {
            const data = e.data;
            if (!data || data.type !== 'karabuddy:signedIn') return;
            try { popup.close(); } catch {}
        };
        window.addEventListener('message', onSignedInMessage);
        const poll = setInterval(() => {
            if (!popup.closed) return;
            clearInterval(poll);
            window.removeEventListener('message', onSignedInMessage);
            // Bust the cache + repaint.
            whoamiCache = null;
            refreshWhoamiBlock();
        }, 400);
    };

    const refreshWhoamiBlock = async () => {
        const block = document.getElementById('karabast-replays-panel-whoami');
        if (!block) return;
        block.replaceChildren();
        block.style.color = '#6c7588';
        block.style.fontStyle = 'normal';
        const data = await loadWhoami();
        if (!block.isConnected) return; // panel closed mid-fetch
        if (!data || data.signedOut) {
            const note = document.createElement('div');
            note.setAttribute('style', 'font-style: italic; margin-bottom: 6px;');
            note.textContent = 'Not signed in to karabuddy.';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'Sign in on karabuddy →';
            btn.setAttribute('style', [
                'background: rgba(74, 124, 255, 0.18)',
                'color: #d6e7ff',
                'border: 1px solid #4a7cff',
                'border-radius: 6px',
                'padding: 7px 10px',
                'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
                'cursor: pointer',
                'width: 100%',
                'text-align: center'
            ].join(';'));
            btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openSigninPopup();
            });
            block.appendChild(note);
            block.appendChild(btn);
            return;
        }
        block.style.color = '#a0c4ff';
        block.textContent = `Signed in as ${data.displayName || 'unknown'}`;
    };

    const buildWhoamiBlock = () => {
        const el = document.createElement('div');
        el.id = 'karabast-replays-panel-whoami';
        el.setAttribute('style', [
            'font: 600 11px -apple-system, BlinkMacSystemFont, sans-serif',
            'color: #6c7588',
            'padding-top: 10px',
            'border-top: 1px solid #2e333c'
        ].join(';'));
        el.textContent = 'Loading account…';
        requestAnimationFrame(() => { refreshWhoamiBlock(); });
        return el;
    };

    // Click on the collapsed header's share indicator. Pure toggle:
    //   - currently shared  → go private (saves to lastShareTeamSlugs)
    //   - currently private + remembered teams → restore them
    //   - currently private + no memory      → expand the panel so the
    //     user can pick teams (avoids a silent no-op when they have no
    //     persistent state yet).
    const handleShareToggleClick = () => {
        if (shareTeamSlugs.length > 0) {
            shareTeamSlugs = [];
            persistShareState();
            refreshFooter();
            T()?.show?.('Replay sharing off', { kind: 'info' });
            return;
        }
        if (lastShareTeamSlugs.length > 0) {
            shareTeamSlugs = [...lastShareTeamSlugs];
            persistShareState();
            refreshFooter();
            T()?.show?.(`Sharing with ${shareTeamSlugs.length} team${shareTeamSlugs.length === 1 ? '' : 's'}`, { kind: 'success' });
            return;
        }
        // No memory yet — open the panel so the user can pick teams.
        if (!expanded) expand();
    };

    // Re-render the expanded panel's share section. Called after toggles
    // so the checklist reflects current state without rebuilding the
    // whole panel.
    const refreshSharePanel = async () => {
        const section = document.getElementById('karabast-replays-panel-share-section');
        if (!section) return;
        const list = document.getElementById('karabast-replays-panel-share-list');
        if (!list) return;
        list.innerHTML = '';
        const data = await loadMentionData();
        const teams = data?.teams || [];
        if (teams.length === 0) {
            const empty = document.createElement('div');
            empty.setAttribute('style', 'font-size: 11px; color: #6c7588; font-style: italic; padding: 4px 0;');
            empty.textContent = data
                ? "You're not in any teams yet. Join a team on karabuddy.app to share."
                : 'Sign in on karabuddy.app to see your teams.';
            list.appendChild(empty);
            return;
        }
        for (const team of teams) {
            const row = document.createElement('label');
            row.setAttribute('style', [
                'display: flex',
                'align-items: center',
                'gap: 8px',
                'padding: 5px 7px',
                'border-radius: 4px',
                'background: rgba(255, 255, 255, 0.025)',
                'cursor: pointer'
            ].join(';'));
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = shareTeamSlugs.includes(team.slug);
            checkbox.addEventListener('mousedown', (e) => { e.stopPropagation(); });
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    if (!shareTeamSlugs.includes(team.slug)) shareTeamSlugs.push(team.slug);
                } else {
                    shareTeamSlugs = shareTeamSlugs.filter((s) => s !== team.slug);
                }
                persistShareState();
                refreshFooter(); // header indicator
            });
            const name = document.createElement('span');
            name.setAttribute('style', 'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif; color: #d6d6d6;');
            name.textContent = team.name;
            row.appendChild(checkbox);
            row.appendChild(name);
            list.appendChild(row);
        }
    };

    // Build the share section. Used by both idle and recording bodies.
    const buildShareSection = () => {
        const section = document.createElement('div');
        section.id = 'karabast-replays-panel-share-section';
        section.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid #2e333c;');

        const label = document.createElement('div');
        label.setAttribute('style', 'font: 600 10px -apple-system, BlinkMacSystemFont, sans-serif; color: #6c7588; letter-spacing: 0.08em; text-transform: uppercase;');
        label.textContent = 'Share with teams';
        section.appendChild(label);

        const hint = document.createElement('div');
        hint.setAttribute('style', 'font-size: 11px; color: #6c7588; line-height: 1.4;');
        hint.textContent = 'Replays from this match (and future matches) will surface in checked teams. Stays on until you toggle off.';
        section.appendChild(hint);

        const list = document.createElement('div');
        list.id = 'karabast-replays-panel-share-list';
        list.setAttribute('style', 'display: flex; flex-direction: column; gap: 4px;');
        section.appendChild(list);

        // Kick off async render; the section element returns synchronously
        // so the panel layout doesn't jank.
        requestAnimationFrame(() => { refreshSharePanel(); });

        return section;
    };

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
            'gap: 6px',
            'padding: 0 7px',
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
            'padding: 0 1px',
            'flex: 0 0 auto',
            'pointer-events: none'
        ].join(';'));
        const monoMain = document.createElement('span');
        monoMain.setAttribute('style', 'font: 400 10px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif; color: #fff; letter-spacing: 0; text-transform: uppercase;');
        monoMain.textContent = 'KARA';
        const monoSub = document.createElement('span');
        monoSub.setAttribute('style', 'font: italic 700 8px Georgia, "Times New Roman", serif; color: #5a8cff; letter-spacing: -0.01em; margin-left: 4px; margin-top: -1px;');
        monoSub.textContent = 'buddy';
        mono.appendChild(monoMain);
        mono.appendChild(monoSub);

        // REC indicator — hidden until recording, revealed by refreshFooter.
        const recWrap = document.createElement('span');
        recWrap.id = 'karabast-replays-launcher-rec';
        recWrap.setAttribute('style', [
            'display: none',
            'align-items: center',
            'gap: 4px',
            'padding-left: 5px',
            'border-left: 1px solid rgba(255,255,255,0.12)',
            'flex: 0 0 auto',
            'pointer-events: none'
        ].join(';'));
        const recDot = document.createElement('span');
        recDot.setAttribute('style', 'display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #ff4040; box-shadow: 0 0 5px #ff4040; animation: karabast-rec-pulse 1.4s ease-in-out infinite;');
        const recCount = document.createElement('span');
        recCount.id = 'karabast-replays-launcher-rec-count';
        recCount.setAttribute('style', 'font: 600 9px -apple-system, BlinkMacSystemFont, sans-serif; color: #d6e7ff; letter-spacing: 0.04em;');
        recCount.textContent = 'REC';
        recWrap.appendChild(recDot);
        recWrap.appendChild(recCount);

        // B67: team-share indicator — green dot when this match's replay
        // will be auto-shared with one or more teams. Clickable: toggles
        // OFF if currently sharing; if currently private, restores the
        // last non-empty selection (or expands the panel to pick teams
        // if there's no prior selection to restore).
        const shareWrap = document.createElement('button');
        shareWrap.id = 'karabast-replays-launcher-share';
        shareWrap.type = 'button';
        shareWrap.title = 'Toggle team sharing';
        shareWrap.setAttribute('style', [
            'display: none',
            'align-items: center',
            'gap: 4px',
            'padding: 0 5px',
            'border-left: 1px solid rgba(255,255,255,0.12)',
            'background: transparent',
            'border-top: 0',
            'border-right: 0',
            'border-bottom: 0',
            'color: inherit',
            'cursor: pointer',
            'flex: 0 0 auto',
            'height: 100%'
        ].join(';'));
        const shareDot = document.createElement('span');
        shareDot.setAttribute('style', 'display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #6bd968; box-shadow: 0 0 5px #6bd968;');
        const shareLabel = document.createElement('span');
        shareLabel.id = 'karabast-replays-launcher-share-label';
        shareLabel.setAttribute('style', 'font: 600 9px -apple-system, BlinkMacSystemFont, sans-serif; color: #c8eecf; letter-spacing: 0.04em;');
        shareLabel.textContent = 'SHARED';
        shareWrap.appendChild(shareDot);
        shareWrap.appendChild(shareLabel);
        shareWrap.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        shareWrap.addEventListener('click', (e) => {
            e.stopPropagation();
            handleShareToggleClick();
        });

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
            'width: 18px',
            'height: 18px',
            'font: 15px -apple-system, BlinkMacSystemFont, sans-serif',
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
        header.appendChild(shareWrap);
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
        els.push(linksWrap);

        els.push(buildShareSection());
        els.push(buildWhoamiBlock());

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

        els.push(buildShareSection());
        els.push(buildWhoamiBlock());

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

    // B55c: cached mention autocomplete data. Loaded on first tag-form
    // open via the bridge → service worker → karabuddy.app fetch. 5-min
    // TTL — stale enough that user roster changes propagate, fresh
    // enough that we don't hammer the API on every tag attempt.
    let mentionDataCache = null;
    let mentionDataLoadedAt = 0;
    const MENTION_TTL_MS = 5 * 60 * 1000;
    // Returns:
    //   { teams: [...], members: [...] }  on successful auth (even if both are empty)
    //   null                              on auth failure / network failure
    // The shape difference matters for the share-teams panel — "401"
    // and "signed-in but in 0 teams" need different copy.
    const loadMentionData = async (force = false) => {
        if (!force && mentionDataCache && Date.now() - mentionDataLoadedAt < MENTION_TTL_MS) {
            return mentionDataCache;
        }
        try {
            const result = await B().getTeamsMentionData?.();
            if (result && result.ok) {
                mentionDataCache = { teams: result.teams || [], members: result.members || [] };
                mentionDataLoadedAt = Date.now();
                return mentionDataCache;
            }
        } catch {}
        return null;
    };

    // Detect `@<prefix>` immediately before the cursor (no whitespace
    // between @ and cursor). Returns the prefix string after `@`, or
    // null. Mirrors the web MentionInput.tsx logic.
    const detectMentionContext = (text, cursor) => {
        let i = cursor - 1;
        while (i >= 0) {
            const ch = text[i];
            if (ch === '@') {
                if (i === 0 || /\s/.test(text[i - 1])) {
                    return text.slice(i + 1, cursor);
                }
                return null;
            }
            if (/\s/.test(ch)) return null;
            i--;
        }
        return null;
    };

    const buildMentionSuggestions = (data, prefix) => {
        const p = prefix.toLowerCase();
        if (p.startsWith('team:')) {
            const teamPrefix = p.slice(5);
            return (data.teams || [])
                .filter((t) => t.name.toLowerCase().startsWith(teamPrefix) || t.slug.toLowerCase().startsWith(teamPrefix))
                .map((t) => ({ kind: 'team', slug: t.slug, name: t.name }))
                .slice(0, 6);
        }
        const members = (data.members || [])
            .filter((m) => m.handle.toLowerCase().startsWith(p) || (m.displayName || '').toLowerCase().startsWith(p))
            .map((m) => ({ kind: 'user', userId: m.userId, handle: m.handle, displayName: m.displayName }));
        const teams = (data.teams || [])
            .filter((t) => t.name.toLowerCase().startsWith(p) || t.slug.toLowerCase().startsWith(p))
            .map((t) => ({ kind: 'team', slug: t.slug, name: t.name }));
        return [...members, ...teams].slice(0, 6);
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

        // B55c: relative wrapper so the autocomplete popover can anchor
        // below the textarea.
        const textareaWrap = document.createElement('div');
        textareaWrap.setAttribute('style', 'position: relative; display: flex; flex-direction: column;');

        const input = document.createElement('textarea');
        input.placeholder = 'Optional comment for this moment… @mention to notify';
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

        // B55c: structured mentions for the in-progress tag draft. Reset
        // on form open/close. Picked from the autocomplete popover; bare
        // typed `@word` without selecting is just text and won't notify.
        let formMentions = { userIds: [], teamSlugs: [] };
        const addMention = (kind, id) => {
            if (kind === 'user') {
                if (!formMentions.userIds.includes(id)) formMentions.userIds.push(id);
            } else if (kind === 'team') {
                if (!formMentions.teamSlugs.includes(id)) formMentions.teamSlugs.push(id);
            }
        };

        // Autocomplete popover element (built lazily on first @-detect).
        let popover = null;
        let popoverActiveIndex = 0;
        let popoverSuggestions = [];

        const closePopover = () => {
            if (popover) {
                popover.remove();
                popover = null;
            }
            popoverSuggestions = [];
            popoverActiveIndex = 0;
        };

        const renderPopover = (suggestions) => {
            if (!popover) {
                popover = document.createElement('div');
                popover.setAttribute('style', [
                    'position: absolute',
                    'top: 100%',
                    'left: 0',
                    'right: 0',
                    'margin-top: 4px',
                    'background: rgba(17, 20, 26, 0.98)',
                    'border: 1px solid rgba(74, 124, 255, 0.4)',
                    'border-radius: 6px',
                    'padding: 4px',
                    'z-index: 50',
                    'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5)',
                    'max-height: 240px',
                    'overflow-y: auto'
                ].join(';'));
                popover.addEventListener('mousedown', (e) => { e.stopPropagation(); });
                textareaWrap.appendChild(popover);
            }
            popoverSuggestions = suggestions;
            popover.innerHTML = '';
            suggestions.forEach((s, i) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                const isActive = i === popoverActiveIndex;
                btn.setAttribute('style', [
                    'display: flex',
                    'align-items: center',
                    'gap: 8px',
                    'width: 100%',
                    'padding: 6px 8px',
                    'background: ' + (isActive ? 'rgba(74, 124, 255, 0.18)' : 'transparent'),
                    'border: 0',
                    'border-radius: 4px',
                    'color: #e6e6e6',
                    'font: 12px -apple-system, BlinkMacSystemFont, sans-serif',
                    'cursor: pointer',
                    'text-align: left'
                ].join(';'));
                if (s.kind === 'user') {
                    const handle = document.createElement('span');
                    handle.setAttribute('style', 'color: #5da9ff; font-weight: 600;');
                    handle.textContent = '@' + s.handle;
                    btn.appendChild(handle);
                    if (s.displayName && s.displayName !== s.handle) {
                        const sub = document.createElement('span');
                        sub.setAttribute('style', 'color: #6c7588; font-size: 11px;');
                        sub.textContent = s.displayName;
                        btn.appendChild(sub);
                    }
                } else {
                    const badge = document.createElement('span');
                    badge.setAttribute('style', [
                        'display: inline-flex',
                        'align-items: center',
                        'justify-content: center',
                        'width: 18px',
                        'height: 18px',
                        'border-radius: 4px',
                        'background: rgba(107, 217, 104, 0.15)',
                        'color: #6bd968',
                        'font: 700 9px -apple-system, sans-serif'
                    ].join(';'));
                    badge.textContent = 'T';
                    btn.appendChild(badge);
                    const handle = document.createElement('span');
                    handle.setAttribute('style', 'color: #6bd968; font-weight: 600;');
                    handle.textContent = '@team:' + s.slug;
                    btn.appendChild(handle);
                    const sub = document.createElement('span');
                    sub.setAttribute('style', 'color: #6c7588; font-size: 11px;');
                    sub.textContent = s.name;
                    btn.appendChild(sub);
                }
                btn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    insertSuggestion(s);
                });
                btn.addEventListener('mouseenter', () => {
                    popoverActiveIndex = i;
                    renderPopover(suggestions);
                });
                popover.appendChild(btn);
            });
        };

        const insertSuggestion = (sugg) => {
            const cursor = input.selectionStart || 0;
            const text = input.value;
            let atIndex = -1;
            for (let i = cursor - 1; i >= 0; i--) {
                if (text[i] === '@') { atIndex = i; break; }
                if (/\s/.test(text[i])) break;
            }
            if (atIndex === -1) return;
            const insertText = sugg.kind === 'user' ? '@' + sugg.handle + ' ' : '@team:' + sugg.slug + ' ';
            const next = text.slice(0, atIndex) + insertText + text.slice(cursor);
            input.value = next;
            const pos = atIndex + insertText.length;
            input.setSelectionRange(pos, pos);
            input.focus();
            if (sugg.kind === 'user') addMention('user', sugg.userId);
            else addMention('team', sugg.slug);
            closePopover();
        };

        const recomputePopover = async () => {
            const text = input.value;
            const cursor = input.selectionStart || 0;
            const ctx = detectMentionContext(text, cursor);
            if (ctx === null) {
                closePopover();
                return;
            }
            const data = await loadMentionData();
            if (!data) {
                closePopover();
                return;
            }
            const suggestions = buildMentionSuggestions(data, ctx);
            if (suggestions.length === 0) {
                closePopover();
                return;
            }
            if (popoverActiveIndex >= suggestions.length) popoverActiveIndex = 0;
            renderPopover(suggestions);
        };

        const openForm = () => {
            form.style.display = 'flex';
            input.value = '';
            formMentions = { userIds: [], teamSlugs: [] };
            // Kick off mention data fetch in parallel with form open —
            // it'll be cached by the time the user types `@`.
            loadMentionData();
            setTimeout(() => input.focus(), 0);
        };
        const closeForm = () => {
            form.style.display = 'none';
            closePopover();
            formMentions = { userIds: [], teamSlugs: [] };
        };

        addBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (form.style.display === 'none' || !form.style.display) openForm();
            else closeForm();
        });

        input.addEventListener('keydown', (e) => {
            // B55c: popover-active keyboard nav takes precedence.
            if (popover) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    popoverActiveIndex = (popoverActiveIndex + 1) % popoverSuggestions.length;
                    renderPopover(popoverSuggestions);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    popoverActiveIndex = (popoverActiveIndex - 1 + popoverSuggestions.length) % popoverSuggestions.length;
                    renderPopover(popoverSuggestions);
                    return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    if (popoverSuggestions[popoverActiveIndex]) insertSuggestion(popoverSuggestions[popoverActiveIndex]);
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closePopover();
                    return;
                }
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                R().addTag(input.value.trim(), formMentions);
                closeForm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeForm();
            }
        });
        // B55c: re-check mention context on any keyup (covers arrow-key
        // cursor movement and printable typing alike).
        input.addEventListener('input', () => { recomputePopover(); });
        input.addEventListener('keyup', (e) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
                recomputePopover();
            }
        });
        input.addEventListener('click', () => { recomputePopover(); });

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
            R().addTag(input.value.trim(), formMentions);
            closeForm();
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        textareaWrap.appendChild(input);
        form.appendChild(textareaWrap);
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
        loadShareState();
        refreshFooter();
    };

    const refreshFooter = () => {
        const launcher = document.getElementById(LAUNCHER_ID);
        if (!launcher) return;
        const active = isRecordingActive();

        // REC indicator in the header reveals only while capturing.
        const recBlock = document.getElementById('karabast-replays-launcher-rec');
        if (recBlock) recBlock.style.display = active ? 'flex' : 'none';

        // B67: share indicator in the header reveals only when sharing
        // is currently ON (≥1 team selected). Stays visible whether or
        // not the user is recording — sharing is a persistent setting.
        const shareBlock = document.getElementById('karabast-replays-launcher-share');
        if (shareBlock) shareBlock.style.display = shareTeamSlugs.length > 0 ? 'inline-flex' : 'none';

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
        isPanelOpen: () => expanded,
        // B67: recorder calls this after every successful upload to
        // know which teams to fan out share rows for.
        getShareTeamSlugs
    };
})();
