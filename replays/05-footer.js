// karabuddy.replays.Footer — FooterUI.
//
// Owns all sidebar DOM construction, state-aware section visibility,
// drag-to-resize, collapse/expand, and the live log rendering. Reads from
// NS.Playback (replayState, advance/setMode/etc), NS.Recorder (recording
// length, download), NS.bridge (replay count), NS.Decoder (nothing direct
// today, but log rendering keys off replayState.frames[0].players).
(() => {
    const NS = ((window.__KaraBuddy ||= {}).replays ||= {});
    const { SOLO_SIDE, SOLO_MODE, REPLAY_FLAG } = NS.flags;
    const P = () => NS.Playback;
    const R = () => NS.Recorder;
    const B = () => NS.bridge;

    // ----- Panel constants + persisted geometry -----
    const PANEL_WIDTH_MIN = 200;
    const PANEL_WIDTH_DEFAULT = 320;
    const PANEL_WIDTH_COLLAPSED = 60;
    const PANEL_WIDTH_STORAGE_KEY = 'karabast-replays-panel-width';
    const PANEL_COLLAPSED_STORAGE_KEY = 'karabast-replays-panel-collapsed';

    const loadStoredPanelWidth = () => {
        try {
            const v = parseFloat(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
            return Number.isFinite(v) ? v : PANEL_WIDTH_DEFAULT;
        } catch {
            return PANEL_WIDTH_DEFAULT;
        }
    };
    const loadStoredPanelCollapsed = () => {
        try {
            return localStorage.getItem(PANEL_COLLAPSED_STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    };

    // ----- Message rendering helpers -----
    const renderMessageText = (msg) => {
        if (!msg) return '';
        if (typeof msg === 'string') return msg;
        if (Array.isArray(msg.message)) {
            return msg.message
                .map((part) => (typeof part === 'string' ? part : part?.name ?? ''))
                .join('');
        }
        return '';
    };

    // First player in the frame-0 snapshot's players map is treated as "user"
    // (blue), second as "opponent" (red). Matches what karabast does in
    // spectator mode (setConnectedPlayer to the first key).
    const playerColor = (id) => {
        const players = P().replayState.frames?.[0]?.state?.players;
        if (!players || !id) return null;
        const keys = Object.keys(players);
        if (id === keys[0]) return '#5da9ff';
        if (id === keys[1]) return '#ff6b6b';
        return null;
    };

    const renderMessageEl = (msg) => {
        const wrap = document.createElement('span');
        if (!msg) return wrap;
        if (typeof msg === 'string') {
            wrap.textContent = msg;
            return wrap;
        }
        if (!Array.isArray(msg.message)) return wrap;
        for (const part of msg.message) {
            if (typeof part === 'string') {
                wrap.appendChild(document.createTextNode(part));
                continue;
            }
            const name = part?.name ?? '';
            if (!name) continue;
            const color = part?.type === 'player' ? playerColor(part.id) : null;
            if (color) {
                const span = document.createElement('span');
                span.style.color = color;
                span.style.fontWeight = '600';
                span.textContent = name;
                wrap.appendChild(span);
            } else {
                wrap.appendChild(document.createTextNode(name));
            }
        }
        return wrap;
    };

    // ----- Page-level styles + wrapper frame -----
    const installFooterStyles = () => {
        if (document.getElementById('karabast-replays-frame-styles')) return;
        const style = document.createElement('style');
        style.id = 'karabast-replays-frame-styles';
        // Two compression strategies for the karabast UI:
        //
        // 1. Playback (#karabast-replays-frame wrapper exists): position:absolute
        //    so it sizes to viewport minus the sidebar, and transform makes it
        //    the containing block for karabast's position:fixed descendants so
        //    cards don't escape under our sidebar.
        //
        // 2. Everywhere else (homepage, lobby, etc.): use body padding-left so
        //    karabast's normal-flow content gets pushed right. We don't wrap the
        //    karabast root because that confuses React's reconciler (it holds
        //    refs to children of body and chokes on insertBefore/removeChild
        //    when those children have been moved).
        style.textContent = `
            body.karabast-replays-panel-active > #karabast-replays-frame {
                position: absolute;
                top: 0;
                bottom: 0;
                right: 0;
                width: calc(100vw - var(--karabast-panel-w, ${PANEL_WIDTH_DEFAULT}px));
                transform: translateZ(0);
                overflow: hidden;
            }
            body.karabast-replays-panel-active:not(:has(> #karabast-replays-frame)) {
                padding-left: var(--karabast-panel-w, ${PANEL_WIDTH_DEFAULT}px) !important;
                box-sizing: border-box;
            }
            @keyframes karabast-rec-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.35; }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    };

    const installFrame = () => {
        // Only wrap in playback — wrapping the karabast root on other pages
        // breaks React's reconciler.
        if (!REPLAY_FLAG || !P().replayState.loaded) return;
        if (document.getElementById('karabast-replays-frame')) return;
        const root = document.querySelector('body > .MuiGrid2-container');
        if (!root || !root.parentElement) return;
        const frame = document.createElement('div');
        frame.id = 'karabast-replays-frame';
        root.parentElement.insertBefore(frame, root);
        frame.appendChild(root);
    };

    // ----- Button factory -----
    const btnStyle = [
        'background: #4a7cff',
        'color: white',
        'border: 0',
        'border-radius: 4px',
        'padding: 3px 8px',
        'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
        'cursor: pointer',
        'line-height: 1.2'
    ].join(';');

    const makeFooterBtn = (text, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.setAttribute('style', btnStyle);
        b.addEventListener('click', onClick);
        return b;
    };

    // ----- Full footer DOM construction -----
    const buildFooter = () => {
        const el = document.createElement('div');
        el.id = 'karabast-replays-footer';
        el.setAttribute('style', [
            'position: fixed',
            'left: 0',
            'top: 0',
            'bottom: 0',
            'z-index: 2147483646',
            'background: rgba(17, 20, 26, 0.95)',
            'border-right: 1px solid #2e333c',
            'color: #e6e6e6',
            'font: 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'display: flex',
            'flex-direction: column',
            'box-shadow: 2px 0 12px rgba(0,0,0,0.4)',
            'user-select: none'
        ].join(';'));

        // Drag handle (right edge)
        const handle = document.createElement('div');
        handle.id = 'karabast-replays-footer-handle';
        handle.setAttribute('style', [
            'position: absolute',
            'top: 0',
            'right: -3px',
            'bottom: 0',
            'width: 6px',
            'cursor: ew-resize',
            'background: rgba(74, 124, 255, 0.25)',
            'z-index: 1'
        ].join(';'));
        handle.title = 'Drag to resize';
        handle.addEventListener('mousedown', onDragStart);
        handle.addEventListener('dblclick', () => {
            setExpandedPanelWidth(PANEL_WIDTH_DEFAULT);
            persistPanelWidth();
        });

        // Collapse/expand toggle (always visible — even when collapsed)
        const collapseBtn = document.createElement('button');
        collapseBtn.id = 'karabast-replays-collapse-btn';
        collapseBtn.type = 'button';
        collapseBtn.title = 'Collapse / expand panel';
        collapseBtn.setAttribute('style', [
            'position: absolute',
            'top: 8px',
            'right: 8px',
            'background: transparent',
            'color: #a0a8b8',
            'border: 1px solid #4a4e56',
            'border-radius: 4px',
            'padding: 0',
            'width: 22px',
            'height: 22px',
            'font: 11px -apple-system, BlinkMacSystemFont, sans-serif',
            'line-height: 20px',
            'text-align: center',
            'cursor: pointer',
            'z-index: 2'
        ].join(';'));
        collapseBtn.textContent = '◀';
        collapseBtn.addEventListener('click', () => setPanelCollapsed(!P().replayState.panelCollapsed));

        // Collapsed mode: minimal control stack (data-when-collapsed)
        const collapsedStack = document.createElement('div');
        collapsedStack.dataset.whenCollapsed = '1';
        collapsedStack.setAttribute('style', [
            'position: absolute',
            'top: 50%',
            'left: 0',
            'right: 0',
            'transform: translateY(-50%)',
            'display: none',
            'flex-direction: column',
            'align-items: center',
            'gap: 14px',
            'padding: 8px 0'
        ].join(';'));

        const makeMiniBtn = (text, onClick) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = text;
            b.setAttribute('style', [
                'background: #4a7cff',
                'color: white',
                'border: 0',
                'border-radius: 4px',
                'width: 32px',
                'height: 26px',
                'padding: 0',
                'font: 600 13px -apple-system, BlinkMacSystemFont, sans-serif',
                'cursor: pointer',
                'line-height: 1',
                'display: inline-flex',
                'align-items: center',
                'justify-content: center'
            ].join(';'));
            b.addEventListener('click', onClick);
            return b;
        };

        // Playback collapsed-controls: arrows, frame counter, mode label.
        const cPlaybackPrev = makeMiniBtn('←', () => P().advance(-1));
        cPlaybackPrev.dataset.showState = 'playback';
        const cPlaybackNext = makeMiniBtn('→', () => P().advance(1));
        cPlaybackNext.dataset.showState = 'playback';

        const cFrameGroup = document.createElement('div');
        cFrameGroup.dataset.showState = 'playback';
        cFrameGroup.setAttribute('style', 'display: flex; flex-direction: column; align-items: center; gap: 2px;');
        const cFrameSub = document.createElement('div');
        cFrameSub.setAttribute('style', 'font-size: 8px; color: #6c7588; text-transform: uppercase; letter-spacing: 0.06em;');
        cFrameSub.textContent = 'Frame';
        const cFrameLabel = document.createElement('div');
        cFrameLabel.id = 'karabast-replays-collapsed-frame';
        cFrameLabel.setAttribute('style', 'font-size: 11px; color: #d6d6d6; text-align: center; line-height: 1.1; font-weight: 600;');
        cFrameGroup.appendChild(cFrameSub);
        cFrameGroup.appendChild(cFrameLabel);

        const cModeGroup = document.createElement('div');
        cModeGroup.dataset.showState = 'playback';
        cModeGroup.setAttribute('style', 'display: flex; flex-direction: column; align-items: center; gap: 2px;');
        const cModeSub = document.createElement('div');
        cModeSub.setAttribute('style', 'font-size: 8px; color: #6c7588; text-transform: uppercase; letter-spacing: 0.06em;');
        cModeSub.textContent = 'Step';
        const cModeLabel = document.createElement('div');
        cModeLabel.id = 'karabast-replays-collapsed-mode';
        cModeLabel.setAttribute('style', 'font-size: 11px; color: #d6d6d6; text-align: center; font-weight: 600;');
        cModeGroup.appendChild(cModeSub);
        cModeGroup.appendChild(cModeLabel);

        // Recording collapsed-indicator: pulsing red dot + event count.
        const cRecGroup = document.createElement('div');
        cRecGroup.dataset.showState = 'recording';
        cRecGroup.setAttribute('style', 'display: flex; flex-direction: column; align-items: center; gap: 4px;');
        const cRecDot = document.createElement('span');
        cRecDot.setAttribute('style', 'display: block; width: 10px; height: 10px; border-radius: 50%; background: #ff4040; box-shadow: 0 0 6px #ff4040; animation: karabast-rec-pulse 1.4s ease-in-out infinite;');
        const cRecLabel = document.createElement('div');
        cRecLabel.setAttribute('style', 'font-size: 9px; color: #d6d6d6; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600;');
        cRecLabel.textContent = 'REC';
        const cRecCount = document.createElement('div');
        cRecCount.id = 'karabast-replays-collapsed-rec-count';
        cRecCount.setAttribute('style', 'font-size: 10px; color: #6c7588;');
        cRecGroup.appendChild(cRecDot);
        cRecGroup.appendChild(cRecLabel);
        cRecGroup.appendChild(cRecCount);

        // Idle collapsed: just the brand mark; the expand arrow above is enough cue.
        const cIdleMark = document.createElement('div');
        cIdleMark.dataset.showState = 'idle';
        cIdleMark.setAttribute('style', 'font-size: 9px; color: #6c7588; text-transform: uppercase; letter-spacing: 0.1em; writing-mode: vertical-rl; transform: rotate(180deg);');
        cIdleMark.textContent = 'Replays';

        // Solo collapsed indicator: small Side N pill + a swap mini-button.
        const cSoloGroup = document.createElement('div');
        cSoloGroup.dataset.showState = 'solo';
        cSoloGroup.setAttribute('style', 'display: flex; flex-direction: column; align-items: center; gap: 8px;');
        const cSoloBadge = document.createElement('div');
        cSoloBadge.setAttribute('style', [
            'background: #4a7cff',
            'color: white',
            'font: 700 10px -apple-system, BlinkMacSystemFont, sans-serif',
            'padding: 3px 8px',
            'border-radius: 999px',
            'letter-spacing: 0.05em'
        ].join(';'));
        cSoloBadge.textContent = SOLO_SIDE ? SOLO_SIDE : '?';
        const cSoloSwap = makeMiniBtn('⇄', () => {
            window.dispatchEvent(new CustomEvent('karabast-companion-action', {
                detail: { type: 'swapFocus' }
            }));
        });
        cSoloSwap.title = 'Swap to other window';
        cSoloGroup.appendChild(cSoloBadge);
        cSoloGroup.appendChild(cSoloSwap);

        collapsedStack.appendChild(cPlaybackPrev);
        collapsedStack.appendChild(cPlaybackNext);
        collapsedStack.appendChild(cFrameGroup);
        collapsedStack.appendChild(cModeGroup);
        collapsedStack.appendChild(cRecGroup);
        collapsedStack.appendChild(cIdleMark);
        collapsedStack.appendChild(cSoloGroup);

        // Hidden file input (always present, triggered by Load buttons across states)
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.karareplay,.json,application/json';
        fileInput.style.display = 'none';
        fileInput.id = 'karabast-replays-file';
        fileInput.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) P().loadReplayFromFile(f);
            e.target.value = '';
        });
        const triggerLoad = () => fileInput.click();

        // Header — always-visible title + state-conditional content below.
        const header = document.createElement('div');
        header.dataset.collapsible = '1';
        header.setAttribute('style', [
            'padding: 16px 22px 12px',
            'border-bottom: 1px solid #2e333c',
            'display: flex',
            'flex-direction: column',
            'gap: 6px',
            'flex: 0 0 auto'
        ].join(';'));

        const title = document.createElement('div');
        title.setAttribute('style', 'font-size: 13px; color: #d6d6d6; font-weight: 700; letter-spacing: 0.02em; padding-right: 28px; margin-bottom: 6px;');
        title.textContent = 'KaraBuddy';

        // --- Idle state: replays + saved replays + solo entry.
        const idleSection = document.createElement('div');
        idleSection.dataset.showState = 'idle';
        idleSection.setAttribute('style', 'display: flex; flex-direction: column; gap: 0;');

        const sectionStyle = 'display: flex; flex-direction: column; gap: 8px; padding: 14px 0;';
        const sectionLabelStyle = 'font-size: 13px; color: #d6d6d6; font-weight: 600; letter-spacing: 0.01em;';

        const replaysGroup = document.createElement('div');
        replaysGroup.setAttribute('style', sectionStyle);
        const replaysLabel = document.createElement('div');
        replaysLabel.setAttribute('style', sectionLabelStyle);
        replaysLabel.textContent = 'Replays';
        const replaysDesc = document.createElement('div');
        replaysDesc.setAttribute('style', 'font-size: 12px; color: #a0a8b8; line-height: 1.5;');
        replaysDesc.textContent = 'Watch a .karareplay file, or start a game to record one.';
        const idleLoadBtn = makeFooterBtn('Load replay…', triggerLoad);
        idleLoadBtn.style.alignSelf = 'flex-start';
        replaysGroup.appendChild(replaysLabel);
        replaysGroup.appendChild(replaysDesc);
        replaysGroup.appendChild(idleLoadBtn);

        const recentGroup = document.createElement('div');
        recentGroup.setAttribute('style', sectionStyle + 'border-top: 1px solid #2e333c;');
        const recentLabel = document.createElement('div');
        recentLabel.setAttribute('style', sectionLabelStyle);
        recentLabel.textContent = 'Saved replays';
        const recentDesc = document.createElement('div');
        recentDesc.setAttribute('style', 'font-size: 12px; color: #a0a8b8; line-height: 1.5;');
        recentDesc.textContent = 'Finished games are saved automatically.';
        const recentBtn = makeFooterBtn('Browse replays', () => {
            B().companionRequest({ type: 'openReplaysPage' }).catch((err) =>
                console.error('[karabuddy] failed to open browser:', err)
            );
        });
        recentBtn.style.alignSelf = 'flex-start';
        recentBtn.style.display = 'inline-flex';
        recentBtn.style.alignItems = 'center';
        recentBtn.style.gap = '6px';
        const recentCount = document.createElement('span');
        recentCount.id = 'karabast-replays-recent-count';
        recentCount.setAttribute('style', 'font-size: 11px; opacity: 0.8; background: rgba(255,255,255,0.16); border-radius: 8px; padding: 1px 6px;');
        recentCount.textContent = '…';
        recentBtn.appendChild(recentCount);
        recentGroup.appendChild(recentLabel);
        recentGroup.appendChild(recentDesc);
        recentGroup.appendChild(recentBtn);

        const soloGroup = document.createElement('div');
        soloGroup.setAttribute('style', sectionStyle + 'border-top: 1px solid #2e333c;');
        const soloLabel = document.createElement('div');
        soloLabel.setAttribute('style', sectionLabelStyle);
        soloLabel.textContent = 'Solo testing';
        const soloDesc = document.createElement('div');
        soloDesc.setAttribute('style', 'font-size: 12px; color: #a0a8b8; line-height: 1.5;');
        soloDesc.textContent = 'Two anonymous windows with your saved decks.';
        const soloStartBtn = makeFooterBtn('Start solo session…', () => {
            window.dispatchEvent(new CustomEvent('karabast-companion-action', {
                detail: { type: 'openOptions' }
            }));
        });
        soloStartBtn.style.alignSelf = 'flex-start';
        soloGroup.appendChild(soloLabel);
        soloGroup.appendChild(soloDesc);
        soloGroup.appendChild(soloStartBtn);

        idleSection.appendChild(replaysGroup);
        idleSection.appendChild(recentGroup);
        idleSection.appendChild(soloGroup);

        // --- Solo state: this window is one of the two solo-session tabs.
        const soloSection = document.createElement('div');
        soloSection.dataset.showState = 'solo';
        soloSection.setAttribute('style', 'display: flex; flex-direction: column; gap: 16px;');

        const soloSideCard = document.createElement('div');
        soloSideCard.setAttribute('style', [
            'background: rgba(74, 124, 255, 0.12)',
            'border: 1px solid rgba(74, 124, 255, 0.4)',
            'border-radius: 8px',
            'padding: 12px 14px',
            'display: flex',
            'flex-direction: column',
            'gap: 2px'
        ].join(';'));
        const soloSideTitle = document.createElement('div');
        soloSideTitle.setAttribute('style', 'font-size: 18px; font-weight: 700; color: #d6e7ff; letter-spacing: 0.02em;');
        soloSideTitle.textContent = SOLO_SIDE ? `Side ${SOLO_SIDE}` : 'Solo session';
        const soloSideHint = document.createElement('div');
        soloSideHint.setAttribute('style', 'font-size: 11px; color: #8aa3c8;');
        soloSideHint.textContent = 'You are playing this side';
        soloSideCard.appendChild(soloSideTitle);
        soloSideCard.appendChild(soloSideHint);

        const soloSwapBtn = makeFooterBtn('⇄  Swap windows  (Space)', () => {
            window.dispatchEvent(new CustomEvent('karabast-companion-action', {
                detail: { type: 'swapFocus' }
            }));
        });
        soloSwapBtn.title = 'Swap focus to the other solo window';
        soloSwapBtn.style.whiteSpace = 'nowrap';
        soloSwapBtn.style.padding = '8px 12px';
        soloSwapBtn.style.fontSize = '13px';

        const soloFooterRow = document.createElement('div');
        soloFooterRow.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px;');

        const soloNewSessionBtn = makeFooterBtn('Configure new session…', () => {
            window.dispatchEvent(new CustomEvent('karabast-companion-action', {
                detail: { type: 'openOptions' }
            }));
        });
        soloNewSessionBtn.style.background = 'transparent';
        soloNewSessionBtn.style.border = '1px solid #4a4e56';
        soloNewSessionBtn.style.color = '#a0a8b8';
        soloNewSessionBtn.style.whiteSpace = 'nowrap';

        const soloStopBtn = makeFooterBtn('Stop session', () => {
            if (!confirm('Stop the solo session? Both windows will close.')) return;
            window.dispatchEvent(new CustomEvent('karabast-companion-action', {
                detail: { type: 'stopSession' }
            }));
        });
        soloStopBtn.style.background = 'transparent';
        soloStopBtn.style.border = '1px solid #5a2a2a';
        soloStopBtn.style.color = '#ff6b6b';
        soloStopBtn.style.whiteSpace = 'nowrap';

        soloFooterRow.appendChild(soloNewSessionBtn);
        soloFooterRow.appendChild(soloStopBtn);

        soloSection.appendChild(soloSideCard);
        soloSection.appendChild(soloSwapBtn);
        soloSection.appendChild(soloFooterRow);

        // --- Recording state: REC indicator + event count + download/load row.
        const recSection = document.createElement('div');
        recSection.dataset.showState = 'recording';
        recSection.setAttribute('style', 'display: flex; flex-direction: column; gap: 10px;');
        const recStatus = document.createElement('div');
        recStatus.setAttribute('style', 'display: flex; align-items: center; gap: 8px; font-size: 13px; color: #d6d6d6; font-weight: 600;');
        const recDot = document.createElement('span');
        recDot.setAttribute('style', 'display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ff4040; box-shadow: 0 0 6px #ff4040; animation: karabast-rec-pulse 1.4s ease-in-out infinite;');
        const recLabel = document.createElement('span');
        recLabel.id = 'karabast-replays-footer-rec-label';
        recLabel.textContent = 'Recording…';
        recStatus.appendChild(recDot);
        recStatus.appendChild(recLabel);
        const recHint = document.createElement('div');
        recHint.setAttribute('style', 'font-size: 11px; color: #6c7588; line-height: 1.4;');
        recHint.textContent = 'Saved to the replay browser when the game ends. Use Download to grab a file for sharing.';
        const recBtnRow = document.createElement('div');
        recBtnRow.setAttribute('style', 'display: flex; gap: 6px; flex-wrap: wrap;');
        const recDownloadBtn = makeFooterBtn('Download', () => R().download('manual'));
        const recLoadBtn = makeFooterBtn('Load replay…', triggerLoad);
        recBtnRow.appendChild(recDownloadBtn);
        recBtnRow.appendChild(recLoadBtn);
        recSection.appendChild(recStatus);
        recSection.appendChild(recHint);
        recSection.appendChild(recBtnRow);

        // --- Playback state: frame counter + step controls + mode segmented control.
        const playbackSection = document.createElement('div');
        playbackSection.dataset.showState = 'playback';
        playbackSection.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px;');

        const frameLabel = document.createElement('div');
        frameLabel.id = 'karabast-replays-footer-frame';
        frameLabel.setAttribute('style', 'font-size: 14px; color: #d6d6d6; font-weight: 600;');

        const btnRow = document.createElement('div');
        btnRow.setAttribute('style', 'display: flex; gap: 6px; align-items: center; flex-wrap: wrap;');
        btnRow.appendChild(makeFooterBtn('←', () => P().advance(-1)));
        btnRow.appendChild(makeFooterBtn('→', () => P().advance(1)));
        btnRow.appendChild(makeFooterBtn('Load…', triggerLoad));

        const modeSeg = document.createElement('div');
        modeSeg.id = 'karabast-replays-footer-mode-seg';
        modeSeg.setAttribute('style', [
            'display: inline-flex',
            'align-self: flex-start',
            'border: 1px solid #4a4e56',
            'border-radius: 4px',
            'overflow: hidden',
            'height: 22px'
        ].join(';'));
        const makeSegBtn = (label, mode) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.dataset.mode = mode;
            b.setAttribute('style', [
                'background: transparent',
                'color: #a0a8b8',
                'border: 0',
                'padding: 0 10px',
                'font: 600 11px -apple-system, BlinkMacSystemFont, sans-serif',
                'cursor: pointer',
                'line-height: 22px'
            ].join(';'));
            b.title = `Step by ${label}. Hold Shift+arrow to temporarily switch to the other.`;
            b.addEventListener('click', () => P().setMode(mode));
            return b;
        };
        modeSeg.appendChild(makeSegBtn('Action', 'action'));
        modeSeg.appendChild(makeSegBtn('Frame', 'frame'));

        const stepBlock = document.createElement('div');
        stepBlock.setAttribute('style', 'display: flex; flex-direction: column; gap: 4px; margin-top: 4px;');
        const stepLabel = document.createElement('div');
        stepLabel.setAttribute('style', 'font-size: 11px; color: #6c7588; text-transform: uppercase; letter-spacing: 0.06em;');
        stepLabel.textContent = 'Step by:';
        const stepHint = document.createElement('div');
        stepHint.id = 'karabast-replays-step-hint';
        stepHint.setAttribute('style', 'font-size: 11px; color: #6c7588; font-style: italic;');
        stepBlock.appendChild(stepLabel);
        stepBlock.appendChild(modeSeg);
        stepBlock.appendChild(stepHint);

        playbackSection.appendChild(frameLabel);
        playbackSection.appendChild(btnRow);
        playbackSection.appendChild(stepBlock);

        header.appendChild(title);
        header.appendChild(idleSection);
        header.appendChild(soloSection);
        header.appendChild(recSection);
        header.appendChild(playbackSection);
        header.appendChild(fileInput);

        // Body: log (only meaningful in playback).
        const panel = document.createElement('div');
        panel.id = 'karabast-replays-footer-panel';
        panel.dataset.collapsible = '1';
        panel.dataset.showState = 'playback';
        panel.setAttribute('style', [
            'flex: 1 1 auto',
            'padding: 14px 22px 18px',
            'overflow-y: auto',
            'display: flex',
            'flex-direction: column',
            'gap: 4px'
        ].join(';'));

        const logHeader = document.createElement('div');
        logHeader.id = 'karabast-replays-footer-log-header';
        logHeader.setAttribute('style', 'font-size: 11px; color: #6c7588; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px;');
        logHeader.textContent = 'What happened at this frame';
        const logBody = document.createElement('div');
        logBody.id = 'karabast-replays-footer-log';
        logBody.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 1.4;');

        panel.appendChild(logHeader);
        panel.appendChild(logBody);

        // preview span (used to flatten log entries for the collapsed view)
        const preview = document.createElement('span');
        preview.id = 'karabast-replays-footer-preview';
        preview.style.display = 'none';

        // Persistent footer bar — back to karabast home regardless of state.
        const goHome = () => { location.href = `${location.origin}/`; };

        const footerBar = document.createElement('div');
        footerBar.dataset.collapsible = '1';
        footerBar.setAttribute('style', [
            'padding: 10px 22px',
            'border-top: 1px solid #2e333c',
            'flex: 0 0 auto',
            // Pin to bottom even when the panel (the flex:1 grower) is hidden.
            'margin-top: auto',
            'display: flex',
            'align-items: center',
            'justify-content: flex-start'
        ].join(';'));
        const homeBtn = document.createElement('button');
        homeBtn.type = 'button';
        homeBtn.title = 'Go to karabast.net home';
        homeBtn.textContent = '← Karabast home';
        homeBtn.setAttribute('style', [
            'background: transparent',
            'color: #a0a8b8',
            'border: 0',
            'padding: 4px 0',
            'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'cursor: pointer'
        ].join(';'));
        homeBtn.addEventListener('mouseenter', () => { homeBtn.style.color = '#e6e6e6'; });
        homeBtn.addEventListener('mouseleave', () => { homeBtn.style.color = '#a0a8b8'; });
        homeBtn.addEventListener('click', goHome);
        footerBar.appendChild(homeBtn);

        // Collapsed-mode home button — pinned to bottom-center.
        const collapsedHome = document.createElement('button');
        collapsedHome.dataset.whenCollapsed = '1';
        collapsedHome.type = 'button';
        collapsedHome.title = 'Go to karabast.net home';
        collapsedHome.textContent = '←';
        collapsedHome.setAttribute('style', [
            'position: absolute',
            'bottom: 10px',
            'left: 50%',
            'transform: translateX(-50%)',
            'display: none',
            'background: transparent',
            'color: #a0a8b8',
            'border: 1px solid #4a4e56',
            'border-radius: 4px',
            'width: 32px',
            'height: 26px',
            'padding: 0',
            'font: 600 13px -apple-system, BlinkMacSystemFont, sans-serif',
            'cursor: pointer',
            'align-items: center',
            'justify-content: center'
        ].join(';'));
        collapsedHome.addEventListener('mouseenter', () => { collapsedHome.style.color = '#e6e6e6'; collapsedHome.style.borderColor = '#7a8090'; });
        collapsedHome.addEventListener('mouseleave', () => { collapsedHome.style.color = '#a0a8b8'; collapsedHome.style.borderColor = '#4a4e56'; });
        collapsedHome.addEventListener('click', goHome);

        el.appendChild(handle);
        el.appendChild(collapseBtn);
        el.appendChild(collapsedStack);
        el.appendChild(collapsedHome);
        el.appendChild(header);
        el.appendChild(panel);
        el.appendChild(footerBar);
        el.appendChild(preview);
        return el;
    };

    // ----- Drag-to-resize + collapse/expand logic -----
    let dragState = null;
    const applyPanelLayout = () => {
        const rs = P().replayState;
        const collapsed = !!rs.panelCollapsed;
        const w = collapsed
            ? PANEL_WIDTH_COLLAPSED
            : (rs.panelWidth || PANEL_WIDTH_DEFAULT);
        const el = document.getElementById('karabast-replays-footer');
        if (el) {
            el.style.width = w + 'px';
            const state = el.dataset.state || 'idle';
            for (const c of el.querySelectorAll('[data-collapsible]')) {
                const stateOk = !c.dataset.showState
                    || c.dataset.showState.split(/\s+/).includes(state);
                c.style.display = (collapsed || !stateOk) ? 'none' : '';
            }
            for (const c of el.querySelectorAll('[data-when-collapsed]')) {
                c.style.display = collapsed ? 'flex' : 'none';
            }
            const handle = document.getElementById('karabast-replays-footer-handle');
            if (handle) handle.style.display = collapsed ? 'none' : '';
            const collapseBtn = document.getElementById('karabast-replays-collapse-btn');
            if (collapseBtn) collapseBtn.textContent = collapsed ? '▶' : '◀';
        }
        document.documentElement.style.setProperty('--karabast-panel-w', w + 'px');
    };
    const setExpandedPanelWidth = (w) => {
        const rs = P().replayState;
        const clamped = Math.max(PANEL_WIDTH_MIN, Math.min(window.innerWidth * 0.5, w));
        rs.panelWidth = clamped;
        if (!rs.panelCollapsed) applyPanelLayout();
    };
    const setPanelCollapsed = (collapsed) => {
        P().replayState.panelCollapsed = !!collapsed;
        try { localStorage.setItem(PANEL_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0'); } catch {}
        applyPanelLayout();
    };
    const persistPanelWidth = () => {
        try { localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(P().replayState.panelWidth)); } catch {}
    };
    const onDragStart = (e) => {
        const rs = P().replayState;
        if (rs.panelCollapsed) return;
        e.preventDefault();
        dragState = { startX: e.clientX, startW: rs.panelWidth ?? PANEL_WIDTH_DEFAULT };
        document.body.style.cursor = 'ew-resize';
    };
    window.addEventListener('mousemove', (e) => {
        if (!dragState) return;
        setExpandedPanelWidth(dragState.startW + (e.clientX - dragState.startX));
    });
    window.addEventListener('mouseup', () => {
        if (!dragState) return;
        dragState = null;
        document.body.style.cursor = '';
        persistPanelWidth();
    });

    const installFooter = () => {
        if (!document.body) return;
        if (document.getElementById('karabast-replays-footer')) return;
        document.body.appendChild(buildFooter());
        document.body.classList.add('karabast-replays-panel-active');
        installFrame();
        refreshFooter();
    };

    // ----- State-aware refresh -----
    const currentPanelState = () => {
        if (SOLO_MODE) return 'solo';
        if (P().replayState.loaded) return 'playback';
        if (R().getRecordingLength() > 0) return 'recording';
        return 'idle';
    };

    const refreshReplayBrowser = async () => {
        const countEl = document.getElementById('karabast-replays-recent-count');
        if (!countEl) return;
        const list = await B().listReplays();
        countEl.textContent = list.length === 0 ? 'none yet' : String(list.length);
    };

    const refreshFooter = () => {
        const el = document.getElementById('karabast-replays-footer');
        if (!el) return;
        el.style.display = 'flex';
        document.body.classList.add('karabast-replays-panel-active');

        // Show/hide state-conditional sections (header, body, collapsed children).
        const state = currentPanelState();
        el.dataset.state = state;
        for (const c of el.querySelectorAll('[data-show-state]')) {
            const states = c.dataset.showState.split(/\s+/);
            c.style.display = states.includes(state) ? '' : 'none';
        }

        // Recording-state labels.
        const recCount = R().getRecordingLength();
        const recLabel = document.getElementById('karabast-replays-footer-rec-label');
        if (recLabel) recLabel.textContent = `Recording — ${recCount} events`;
        const cRecCount = document.getElementById('karabast-replays-collapsed-rec-count');
        if (cRecCount) cRecCount.textContent = String(recCount);

        const rs = P().replayState;
        if (rs.panelWidth == null) rs.panelWidth = loadStoredPanelWidth();
        if (rs.panelCollapsed == null) rs.panelCollapsed = loadStoredPanelCollapsed();
        applyPanelLayout();

        // Populate the replay browser whenever idle is on screen. Cheap to call
        // repeatedly — IDB is fast and the list rarely changes between calls.
        if (state === 'idle') refreshReplayBrowser();

        if (state !== 'playback') return;

        const frameEl = document.getElementById('karabast-replays-footer-frame');
        if (frameEl) {
            frameEl.textContent = `Frame ${rs.currentIndex + 1} / ${rs.frames.length}`;
        }
        const cFrame = document.getElementById('karabast-replays-collapsed-frame');
        if (cFrame) {
            cFrame.textContent = `${rs.currentIndex + 1} / ${rs.frames.length}`;
        }
        const cMode = document.getElementById('karabast-replays-collapsed-mode');
        if (cMode) {
            cMode.textContent = rs.mode === 'action' ? 'Act' : 'Frm';
        }
        const modeSeg = document.getElementById('karabast-replays-footer-mode-seg');
        if (modeSeg) {
            for (const btn of modeSeg.querySelectorAll('button')) {
                const selected = btn.dataset.mode === rs.mode;
                btn.style.background = selected ? '#4a7cff' : 'transparent';
                btn.style.color = selected ? 'white' : '#a0a8b8';
            }
        }
        const stepHint = document.getElementById('karabast-replays-step-hint');
        if (stepHint) {
            const other = rs.mode === 'action' ? 'Frame' : 'Action';
            stepHint.textContent = `Hold ⇧ + ← → to step by ${other}`;
        }

        // Compute the range of frames whose messages we should show.
        // Forward step (from→to where to>from): messages from frames (from+1..to)
        //   — "what just happened" to land here.
        // Backward step OR initial load: just show the messages logged at the
        // current frame — i.e. what karabast would have originally surfaced
        // when this gamestate first arrived.
        const cur = rs.currentIndex;
        const lt = rs.lastTransition;
        let logFrames = [cur];
        let direction = null;
        if (lt && lt.to > lt.from) {
            const lo = lt.from;
            const hi = lt.to;
            logFrames = [];
            for (let i = lo + 1; i <= hi; i++) logFrames.push(i);
            direction = 'forward';
        }

        const logHeaderEl = document.getElementById('karabast-replays-footer-log-header');
        if (logHeaderEl) {
            if (direction === 'forward') {
                logHeaderEl.textContent = logFrames.length > 1
                    ? `What happened (over ${logFrames.length} frames)`
                    : 'What happened';
            } else {
                logHeaderEl.textContent = 'What happened at this frame';
            }
        }

        // Cumulative log up to and including the current frame. The most recent
        // batch (logFrames) renders at full opacity to draw the eye; everything
        // older dims to make it clearly historical.
        const highlightSet = new Set(logFrames);
        const allMessages = [];
        for (let i = 0; i <= cur; i++) {
            const fmsgs = rs.messagesByFrame?.[i] || [];
            for (const m of fmsgs) {
                allMessages.push({ frame: i, msg: m, highlighted: highlightSet.has(i) });
            }
        }

        const preview = document.getElementById('karabast-replays-footer-preview');
        if (preview) {
            const flat = allMessages
                .filter((e) => e.highlighted)
                .map((e) => renderMessageText(e.msg));
            preview.textContent = flat.length ? flat.join(' · ') : '(no log entries)';
        }

        const log = document.getElementById('karabast-replays-footer-log');
        if (log) {
            log.innerHTML = '';
            if (allMessages.length === 0) {
                const empty = document.createElement('div');
                empty.setAttribute('style', 'color: #6c7588; font-style: italic;');
                empty.textContent = '(no log entries yet)';
                log.appendChild(empty);
            } else {
                let firstHighlightedRow = null;
                for (const entry of allMessages) {
                    const row = document.createElement('div');
                    row.style.opacity = entry.highlighted ? '1' : '0.45';
                    row.style.transition = 'opacity 120ms ease';
                    row.appendChild(renderMessageEl(entry.msg));
                    log.appendChild(row);
                    if (entry.highlighted && !firstHighlightedRow) firstHighlightedRow = row;
                }
                if (firstHighlightedRow) {
                    firstHighlightedRow.scrollIntoView({ block: 'center', behavior: 'instant' });
                } else {
                    log.scrollTop = log.scrollHeight;
                }
            }
        }
    };

    NS.Footer = {
        installFooterStyles,
        installFrame,
        installFooter,
        refreshFooter,
        // Aliases — Recorder + Playback both call refreshOverlay/updateOverlay.
        refreshOverlay: refreshFooter,
        updateOverlay: refreshFooter,
        refreshReplayBrowser,
        currentPanelState
    };
})();
