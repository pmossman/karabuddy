// karabuddy.replays.Footer — FooterUI.
//
// Owns all sidebar DOM construction, state-aware section visibility,
// drag-to-resize, and collapse/expand. After B17, the sidebar is
// recording-focused: idle shows a tiny landing pointing at karabuddy.com,
// recording shows the REC indicator + tag controls, and playback shows
// only the header + exit button (the karabast.net renderer fills the rest
// of the viewport — playback chrome lives on karabuddy.com now).
(() => {
    const NS = ((window.__KaraBuddy ||= {}).replays ||= {});
    const { SOLO_SIDE, SOLO_MODE, REPLAY_FLAG } = NS.flags;
    const P = () => NS.Playback;
    const R = () => NS.Recorder;
    const B = () => NS.bridge;
    const D = () => NS.Decoder;

    // ----- Panel constants + persisted geometry -----
    const PANEL_WIDTH_MIN = 200;
    const PANEL_WIDTH_DEFAULT = 320;
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

    // ----- Page-level styles + wrapper frame -----
    const installFooterStyles = () => {
        if (document.getElementById('karabast-replays-frame-styles')) return;
        const style = document.createElement('style');
        style.id = 'karabast-replays-frame-styles';
        // Playback (#karabast-replays-frame wrapper exists): position:absolute
        // so it sizes to viewport minus the sidebar, and transform makes it
        // the containing block for karabast's position:fixed descendants so
        // cards don't escape under our sidebar.
        //
        // Outside playback the sidebar is an OVERLAY — we don't push body
        // content, because the resulting viewport mismatch causes karabast's
        // position:fixed modals/popovers to center on the full window and end
        // up clipped behind the sidebar. The user opens/closes the sidebar
        // via the floating launcher button (top-left); when open they accept
        // that karabast's leftmost ~panel-width is covered.
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

    // ----- Tag UI primitives (recording only post-B17) -----
    //
    // buildTagBlock builds: "+ Tag …" button + inline comment editor + list
    // container. renderTagList(listEl, tags, currentFrame) repaints the list
    // portion — called from refreshFooter on each refresh.
    const buildTagBlock = ({
        buttonLabel,
        inputPlaceholder,
        listId,
        onSubmit,
        onDelete,
        onUpdateComment,
        getCurrentAuthor,
        getPlayerUsernames
    }) => {
        const wrap = document.createElement('div');
        wrap.setAttribute('style', 'display: flex; flex-direction: column; gap: 8px;');

        const form = document.createElement('div');
        const formLabel = document.createElement('div');
        const formAuthorDot = document.createElement('span');
        const formAuthorText = document.createElement('span');
        const input = document.createElement('textarea');

        const openForm = () => {
            const author = getCurrentAuthor();
            const playerUsernames = getPlayerUsernames ? getPlayerUsernames() : null;
            formAuthorDot.style.background = D().playerColorFor(author, playerUsernames);
            formAuthorText.textContent = `Tagging as ${author}`;
            form.style.display = 'flex';
            input.value = '';
            setTimeout(() => input.focus(), 0);
        };
        const closeForm = () => { form.style.display = 'none'; };

        const addBtn = makeFooterBtn(buttonLabel, () => {
            if (form.style.display !== 'none') closeForm();
            else openForm();
        });
        addBtn.style.alignSelf = 'stretch';
        addBtn.style.padding = '10px 14px';
        addBtn.style.fontSize = '13px';
        addBtn.style.background = 'rgba(74, 124, 255, 0.18)';
        addBtn.style.border = '1px solid #4a7cff';
        addBtn.style.color = '#d6e7ff';

        form.setAttribute('style', [
            'display: none',
            'flex-direction: column',
            'gap: 6px',
            'padding: 8px',
            'background: rgba(74, 124, 255, 0.08)',
            'border: 1px solid rgba(74, 124, 255, 0.3)',
            'border-radius: 6px'
        ].join(';'));

        formLabel.setAttribute('style', 'font-size: 11px; color: #a0a8b8; display: flex; align-items: center; gap: 6px;');
        formAuthorDot.setAttribute('style', 'display: inline-block; width: 8px; height: 8px; border-radius: 50%;');
        formLabel.appendChild(formAuthorDot);
        formLabel.appendChild(formAuthorText);

        input.placeholder = inputPlaceholder;
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
        input.addEventListener('keydown', (e) => {
            // Cmd/Ctrl+Enter to save; Esc to cancel.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                onSubmit(input.value.trim());
                closeForm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeForm();
            }
        });

        const btnRow = document.createElement('div');
        btnRow.setAttribute('style', 'display: flex; gap: 6px; align-self: flex-end;');
        const cancelBtn = makeFooterBtn('Cancel', closeForm);
        cancelBtn.style.background = 'transparent';
        cancelBtn.style.border = '1px solid #4a4e56';
        cancelBtn.style.color = '#a0a8b8';
        const saveBtn = makeFooterBtn('Save tag', () => {
            onSubmit(input.value.trim());
            closeForm();
        });
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);

        form.appendChild(formLabel);
        form.appendChild(input);
        form.appendChild(btnRow);

        const list = document.createElement('div');
        list.id = listId;
        list.setAttribute('style', 'display: flex; flex-direction: column; gap: 4px;');
        list._handlers = { onDelete, onUpdateComment };

        wrap.appendChild(addBtn);
        wrap.appendChild(form);
        wrap.appendChild(list);
        return wrap;
    };

    const renderTagList = (listEl, tags, currentFrame, currentAuthor, playerUsernames) => {
        if (!listEl) return;
        listEl.innerHTML = '';
        if (!tags || tags.length === 0) {
            const empty = document.createElement('div');
            empty.setAttribute('style', 'font-size: 11px; color: #6c7588; font-style: italic; padding: 4px 0;');
            empty.textContent = 'No tags yet.';
            listEl.appendChild(empty);
            return;
        }
        const handlers = listEl._handlers || {};
        // Sort by frameIndex for a natural chronological reading order.
        const sorted = [...tags].sort((a, b) => a.frameIndex - b.frameIndex);
        for (const tag of sorted) {
            const row = document.createElement('div');
            const isCurrent = tag.frameIndex === currentFrame;
            const isOwn = tag.author === currentAuthor;
            const color = D().playerColorFor(tag.author, playerUsernames);
            const opacity = isCurrent ? '1' : '0.6';
            row.setAttribute('style', [
                'display: grid',
                'grid-template-columns: 4px 1fr auto',
                'gap: 8px',
                'padding: 5px 7px',
                'border-radius: 4px',
                'background: ' + (isCurrent ? 'rgba(74, 124, 255, 0.12)' : 'rgba(255, 255, 255, 0.025)'),
                'border-left: 3px solid ' + color,
                'opacity: ' + opacity
            ].join(';'));

            const _gutter = document.createElement('span'); // empty filler for the 4px column
            row.appendChild(_gutter);

            const body = document.createElement('div');
            body.setAttribute('style', 'display: flex; flex-direction: column; gap: 2px; min-width: 0;');
            const head = document.createElement('div');
            head.setAttribute('style', 'display: flex; align-items: center; gap: 8px; font-size: 11px; color: #a0a8b8;');
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
            body.appendChild(head);

            // Comment — editable in place for own tags. Click to edit.
            const comment = document.createElement('div');
            comment.setAttribute('style', 'font-size: 12px; color: #d6d6d6; line-height: 1.35; word-wrap: break-word; white-space: pre-wrap;');
            comment.textContent = tag.comment || (isOwn ? '(click to add comment)' : '(no comment)');
            if (!tag.comment) comment.style.color = '#6c7588';
            if (isOwn && handlers.onUpdateComment) {
                comment.style.cursor = 'text';
                comment.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const ta = document.createElement('textarea');
                    ta.value = tag.comment || '';
                    ta.rows = 2;
                    ta.setAttribute('style', [
                        'width: 100%',
                        'box-sizing: border-box',
                        'background: #11141a',
                        'color: #e6e6e6',
                        'border: 1px solid #4a7cff',
                        'border-radius: 4px',
                        'padding: 4px 6px',
                        'font: 12px -apple-system, BlinkMacSystemFont, sans-serif',
                        'resize: vertical',
                        'outline: none'
                    ].join(';'));
                    const finish = (save) => {
                        if (save) handlers.onUpdateComment(tag.id, ta.value.trim());
                        else renderTagList(listEl, tags, currentFrame, currentAuthor, playerUsernames);
                    };
                    ta.addEventListener('keydown', (ev) => {
                        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
                            ev.preventDefault();
                            finish(true);
                        } else if (ev.key === 'Escape') {
                            ev.preventDefault();
                            finish(false);
                        }
                    });
                    ta.addEventListener('blur', () => finish(true));
                    comment.replaceWith(ta);
                    ta.focus();
                    ta.select();
                });
            }
            body.appendChild(comment);
            row.appendChild(body);

            const actions = document.createElement('div');
            actions.setAttribute('style', 'display: flex; align-items: flex-start;');
            if (isOwn && handlers.onDelete) {
                const del = document.createElement('button');
                del.type = 'button';
                del.textContent = '✕';
                del.title = 'Delete this tag';
                del.setAttribute('style', [
                    'background: transparent',
                    'border: 0',
                    'color: #6c7588',
                    'cursor: pointer',
                    'padding: 0 4px',
                    'font: 13px -apple-system, BlinkMacSystemFont, sans-serif',
                    'line-height: 1'
                ].join(';'));
                del.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handlers.onDelete(tag.id);
                });
                del.addEventListener('mouseenter', () => { del.style.color = '#ff6b6b'; });
                del.addEventListener('mouseleave', () => { del.style.color = '#6c7588'; });
                actions.appendChild(del);
            }
            row.appendChild(actions);

            listEl.appendChild(row);
        }
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
        collapseBtn.addEventListener('click', () => setPanelCollapsed(true));

        // Header — always-visible title + state-conditional content below.
        const header = document.createElement('div');
        header.setAttribute('style', [
            'padding: 16px 22px 12px',
            'border-bottom: 1px solid #2e333c',
            'display: flex',
            'flex-direction: column',
            'gap: 6px',
            'flex: 0 0 auto'
        ].join(';'));

        // Logo: "KARA" mirrors the karabast.net wordmark (heavy uppercase sans);
        // "buddy" is our own voice — Georgia italic in accent blue — to read as
        // a companion mark, not a clone.
        const title = document.createElement('div');
        title.setAttribute('style', [
            'display: flex',
            'flex-direction: column',
            'line-height: 0.95',
            'padding-right: 28px',
            'margin-bottom: 10px',
            'user-select: none'
        ].join(';'));

        const titleMain = document.createElement('div');
        titleMain.setAttribute('style', [
            // Match karabast.net's wordmark: Barlow regular (weight 400),
            // not bold. The --font-barlow CSS variable is set on <html>
            // by their Next.js font loader, so it's available to our
            // content-script-injected DOM for free.
            'font: 400 34px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif',
            'color: #ffffff',
            'letter-spacing: 0',
            'text-transform: uppercase'
        ].join(';'));
        titleMain.textContent = 'KARA';

        const titleSub = document.createElement('div');
        titleSub.setAttribute('style', [
            'font: italic 600 24px Georgia, "Times New Roman", serif',
            'color: #5a8cff',
            'letter-spacing: -0.005em',
            'margin-left: 42px',
            'margin-top: -2px'
        ].join(';'));
        titleSub.textContent = 'buddy';

        title.appendChild(titleMain);
        title.appendChild(titleSub);

        // --- Idle state (no game running): tiny landing — auto-recording hint
        // and two link buttons to karabuddy.com. All replay browsing,
        // playback, account settings, and solo entry have moved to the
        // karabuddy webapp; the extension's sidebar no longer duplicates them.
        const idleSection = document.createElement('div');
        idleSection.dataset.showState = 'idle';
        idleSection.setAttribute('style', 'display: flex; flex-direction: column; gap: 14px; padding: 14px 0;');

        const idleHint = document.createElement('div');
        idleHint.setAttribute('style', 'font-size: 12px; color: #a0a8b8; line-height: 1.5;');
        idleHint.textContent = 'Recording is automatic during karabast matches.';

        const idleLinks = document.createElement('div');
        idleLinks.setAttribute('style', 'display: flex; flex-direction: column; gap: 8px;');

        const openReplaysBtn = makeFooterBtn('Open my replays →', () => {
            B().companionRequest({ type: 'openReplaysPage' }).catch((err) =>
                console.error('[karabuddy] failed to open replays:', err)
            );
        });
        openReplaysBtn.style.alignSelf = 'stretch';
        openReplaysBtn.style.padding = '8px 12px';
        openReplaysBtn.style.fontSize = '13px';

        const linkExtBtn = makeFooterBtn('Link this extension →', () => {
            B().openKarabuddyClaim().catch((err) =>
                console.error('[karabuddy] failed to open claim:', err)
            );
        });
        linkExtBtn.style.alignSelf = 'stretch';
        linkExtBtn.style.padding = '8px 12px';
        linkExtBtn.style.fontSize = '13px';
        linkExtBtn.style.background = 'transparent';
        linkExtBtn.style.border = '1px solid #4a7cff';
        linkExtBtn.style.color = '#5da9ff';

        idleLinks.appendChild(openReplaysBtn);
        idleLinks.appendChild(linkExtBtn);

        idleSection.appendChild(idleHint);
        idleSection.appendChild(idleLinks);

        // --- Solo state: this window is one of the two solo-session tabs.
        // Left alone for B17 — solo is still extension-only and is its own
        // future task to move to karabuddy.
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

        // "Stop session" moved to the contextual footer exit button so we
        // don't render two exits for the same state.
        const soloNewSessionBtn = makeFooterBtn('Configure new session…', () => {
            window.dispatchEvent(new CustomEvent('karabast-companion-action', {
                detail: { type: 'openOptions' }
            }));
        });
        soloNewSessionBtn.style.background = 'transparent';
        soloNewSessionBtn.style.border = '1px solid #4a4e56';
        soloNewSessionBtn.style.color = '#a0a8b8';
        soloNewSessionBtn.style.whiteSpace = 'nowrap';

        soloSection.appendChild(soloSideCard);
        soloSection.appendChild(soloSwapBtn);
        soloSection.appendChild(soloNewSessionBtn);

        // --- Recording state: the primary panel post-B17. REC indicator,
        // prominent "+ Tag this moment" button, and the recent tags list.
        // Once mid-game uploads exist, the hidden "Open on karabuddy" link
        // can surface as soon as recorder reports a karabuddySlug.
        const recSection = document.createElement('div');
        recSection.dataset.showState = 'recording';
        recSection.setAttribute('style', 'display: flex; flex-direction: column; gap: 12px;');
        const recStatus = document.createElement('div');
        recStatus.setAttribute('style', 'display: flex; align-items: center; gap: 10px; font-size: 16px; color: #ffffff; font-weight: 700; letter-spacing: 0.05em;');
        const recDot = document.createElement('span');
        recDot.setAttribute('style', 'display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #ff4040; box-shadow: 0 0 8px #ff4040; animation: karabast-rec-pulse 1.4s ease-in-out infinite;');
        const recLabel = document.createElement('span');
        recLabel.id = 'karabast-replays-footer-rec-label';
        recLabel.textContent = 'REC';
        recStatus.appendChild(recDot);
        recStatus.appendChild(recLabel);
        const recHint = document.createElement('div');
        recHint.setAttribute('style', 'font-size: 11px; color: #6c7588; line-height: 1.4;');
        recHint.textContent = 'Saves automatically and uploads to karabuddy when the game ends.';
        const recTagBlock = buildTagBlock({
            buttonLabel: '+ Tag this moment',
            inputPlaceholder: 'Optional comment for this moment…',
            listId: 'karabast-replays-rec-tag-list',
            onSubmit: (comment) => R().addTag(comment),
            onDelete: (id) => R().deleteTag(id),
            onUpdateComment: (id, comment) => R().updateTagComment(id, comment),
            getCurrentAuthor: () => D().getOrCreateAuthor(R().getCurrentPlayers()),
            getPlayerUsernames: () => R().getPlayerUsernames()
        });

        // "Open this replay on karabuddy" — hidden by default. Shown only
        // after a mid-game upload populates a slug. Until that flow exists
        // the link stays hidden; the structure is here so a future patch
        // can flip display:flex once R().getCurrentKarabuddyUrl() returns
        // a value.
        const recOpenLink = document.createElement('a');
        recOpenLink.id = 'karabast-replays-rec-open-link';
        recOpenLink.target = '_blank';
        recOpenLink.rel = 'noopener noreferrer';
        recOpenLink.textContent = 'Open this replay on karabuddy →';
        recOpenLink.setAttribute('style', [
            'display: none',
            'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'color: #5da9ff',
            'text-decoration: none',
            'padding: 6px 0'
        ].join(';'));

        recSection.appendChild(recStatus);
        recSection.appendChild(recHint);
        recSection.appendChild(recTagBlock);
        recSection.appendChild(recOpenLink);

        header.appendChild(title);
        header.appendChild(idleSection);
        header.appendChild(soloSection);
        header.appendChild(recSection);

        // Body panel — kept as the flex grower so the exit footer pins to
        // the bottom. Empty post-B17 (the playback log lived here).
        const panel = document.createElement('div');
        panel.id = 'karabast-replays-footer-panel';
        panel.setAttribute('style', [
            'flex: 1 1 auto',
            'padding: 0',
            'overflow-y: auto'
        ].join(';'));

        // Contextual exit bar — only shown in playback / solo. Label and
        // action are wired in refreshFooter() based on currentPanelState().
        // Idle and recording states get no footer (nothing meaningful to exit).
        const footerBar = document.createElement('div');
        footerBar.dataset.showState = 'playback solo';
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
        const exitBtn = document.createElement('button');
        exitBtn.id = 'karabast-replays-footer-exit';
        exitBtn.type = 'button';
        exitBtn.setAttribute('style', [
            'background: transparent',
            'color: #a0a8b8',
            'border: 0',
            'padding: 4px 0',
            'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'cursor: pointer'
        ].join(';'));
        exitBtn.addEventListener('mouseenter', () => { exitBtn.style.color = '#e6e6e6'; });
        exitBtn.addEventListener('mouseleave', () => { exitBtn.style.color = '#a0a8b8'; });
        footerBar.appendChild(exitBtn);

        el.appendChild(handle);
        el.appendChild(collapseBtn);
        el.appendChild(header);
        el.appendChild(panel);
        el.appendChild(footerBar);
        return el;
    };

    // ----- Drag-to-resize + collapse/expand logic -----
    let dragState = null;
    const applyPanelLayout = () => {
        const rs = P().replayState;
        const collapsed = !!rs.panelCollapsed;
        const w = rs.panelWidth || PANEL_WIDTH_DEFAULT;
        const el = document.getElementById('karabast-replays-footer');
        if (el) {
            el.style.width = w + 'px';
            el.style.display = collapsed ? 'none' : 'flex';
        }
        const launcher = document.getElementById('karabast-replays-launcher');
        if (launcher) launcher.style.display = collapsed ? 'flex' : 'none';
        // Zero out the panel-width var when collapsed so the playback frame
        // (width: 100vw - --karabast-panel-w) stretches edge-to-edge.
        document.documentElement.style.setProperty('--karabast-panel-w', (collapsed ? 0 : w) + 'px');
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

    // Floating "open sidebar" button — shown only when the sidebar is collapsed.
    // Sits at top-left so the user always has a way back to KaraBuddy without
    // the sidebar permanently occupying screen real estate. The mark mirrors
    // the logo (bold K, italic b) so the launcher reads as KaraBuddy at a
    // glance, with a gear badge to signal "click to toggle".
    //
    // Draggable: mousedown starts tracking; if the cursor moves more than
    // LAUNCHER_DRAG_THRESHOLD pixels before mouseup we treat the gesture as
    // a drag (no click), otherwise we open the sidebar as before. Final
    // position is clamped to viewport and persisted to chrome.storage.local.
    const LAUNCHER_POS_STORAGE_KEY = 'karabuddyLauncherPos';
    const LAUNCHER_DRAG_THRESHOLD = 4; // pixels of total movement before click → drag
    const LAUNCHER_SIZE = 42;

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
            'width: ' + LAUNCHER_SIZE + 'px',
            'height: ' + LAUNCHER_SIZE + 'px',
            'border-radius: 10px',
            'background: linear-gradient(140deg, #243044 0%, #1a1d23 100%)',
            'border: 1px solid rgba(74, 124, 255, 0.5)',
            'padding: 0',
            'cursor: grab',
            'box-shadow: 0 2px 12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0,0,0,0.3)',
            'display: none',
            'align-items: center',
            'justify-content: center',
            'transition: transform 120ms ease, border-color 120ms ease',
            'touch-action: none'
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
        // Listeners are attached to window during the gesture so the drag
        // continues even if the cursor strays off the button.
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
                setPanelCollapsed(false);
            }
        };
        b.addEventListener('mousedown', (e) => {
            // Only react to left mouse button.
            if (e.button !== 0) return;
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

        // Tiny stacked KARA/buddy — same DNA as the full header logo,
        // shrunk to fit the launcher. Avoids "Kb" since karabast already
        // uses that as its own shorthand.
        const mono = document.createElement('span');
        mono.setAttribute('style', [
            'display: flex',
            'flex-direction: column',
            'align-items: flex-start',
            'line-height: 0.95',
            'padding: 0 4px'
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

        // Recording badge: pulsing red dot in bottom-right corner. Only
        // visible while the recorder is active. Useful when the user has
        // collapsed the sidebar mid-game — otherwise they'd have no way to
        // know a recording is still capturing.
        const recDot = document.createElement('span');
        recDot.id = 'karabast-replays-launcher-rec';
        recDot.setAttribute('style', [
            'position: absolute',
            'bottom: -3px',
            'right: -3px',
            'width: 12px',
            'height: 12px',
            'border-radius: 50%',
            'background: #ff4040',
            'box-shadow: 0 0 6px #ff4040',
            'border: 2px solid #11141a',
            'display: none',
            'animation: karabast-rec-pulse 1.4s ease-in-out infinite'
        ].join(';'));

        b.appendChild(mono);
        b.appendChild(recDot);
        // Click → open sidebar is handled in the mouseup handler above
        // (only when the gesture wasn't a drag). We still suppress any
        // synthetic click that follows a drag, defensively.
        b.addEventListener('click', (e) => {
            // If a drag just happened the mouseup handler already cleared
            // launcherDrag — but block the click anyway to avoid double-toggling.
            e.preventDefault();
            e.stopPropagation();
        });
        return b;
    };

    const installFooter = () => {
        if (!document.body) return;
        if (document.getElementById('karabast-replays-footer')) return;
        document.body.appendChild(buildFooter());
        document.body.appendChild(buildLauncher());
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

    const refreshFooter = () => {
        const el = document.getElementById('karabast-replays-footer');
        if (!el) return;
        el.style.display = 'flex';
        document.body.classList.add('karabast-replays-panel-active');

        // Show/hide state-conditional sections.
        const state = currentPanelState();
        el.dataset.state = state;
        for (const c of el.querySelectorAll('[data-show-state]')) {
            const states = c.dataset.showState.split(/\s+/);
            c.style.display = states.includes(state) ? '' : 'none';
        }

        // Recording-state label: REC + live event count.
        const recCount = R().getRecordingLength();
        const recLabel = document.getElementById('karabast-replays-footer-rec-label');
        if (recLabel) recLabel.textContent = `REC · ${recCount} events`;

        // Launcher recording badge — visible whenever the recorder is
        // active, regardless of whether the launcher itself is currently
        // shown (it'll appear the moment the user collapses the sidebar).
        const launcherRec = document.getElementById('karabast-replays-launcher-rec');
        if (launcherRec) launcherRec.style.display = state === 'recording' ? 'block' : 'none';

        // Repaint the recording tag list. Author resolution uses live
        // players from the Recorder so tags created under a real karabast
        // username register as own-author for edit/delete affordances.
        if (state === 'recording') {
            const currentAuthor = D().getOrCreateAuthor(R().getCurrentPlayers());
            const playerUsernames = R().getPlayerUsernames();
            const recList = document.getElementById('karabast-replays-rec-tag-list');
            renderTagList(recList, R().getTags(), R().getCurrentFrameIndex(), currentAuthor, playerUsernames);

            // Optional "Open on karabuddy" link — hidden until the recorder
            // exposes a hosted URL (mid-game upload). Defensive: only shows
            // if getCurrentKarabuddyUrl exists and returns a string.
            const openLink = document.getElementById('karabast-replays-rec-open-link');
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

        // Contextual exit button — only meaningful in playback / solo.
        // Stable handler closes over el so we can re-wire each refresh
        // without leaking listeners.
        const exitBtn = document.getElementById('karabast-replays-footer-exit');
        if (exitBtn) {
            exitBtn.onclick = null;
            if (state === 'playback') {
                exitBtn.textContent = '← Exit replay';
                exitBtn.title = 'Leave playback and return to karabast.net';
                exitBtn.onclick = () => { location.href = `${location.origin}/`; };
            } else if (state === 'solo') {
                exitBtn.textContent = '⨯ Quit solo session';
                exitBtn.title = 'Stop both solo windows';
                exitBtn.onclick = () => {
                    if (!confirm('Stop the solo session? Both windows will close.')) return;
                    window.dispatchEvent(new CustomEvent('karabast-companion-action', {
                        detail: { type: 'stopSession' }
                    }));
                };
            }
        }

        const rs = P().replayState;
        if (rs.panelWidth == null) rs.panelWidth = loadStoredPanelWidth();
        if (rs.panelCollapsed == null) rs.panelCollapsed = loadStoredPanelCollapsed();
        applyPanelLayout();
    };

    NS.Footer = {
        installFooterStyles,
        installFrame,
        installFooter,
        refreshFooter,
        // Aliases — Recorder + Playback both call refreshOverlay/updateOverlay.
        refreshOverlay: refreshFooter,
        updateOverlay: refreshFooter,
        currentPanelState
    };
})();
