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

    // ----- Tag UI primitives -----
    //
    // buildTagBlock builds: "+ Tag …" button + inline comment editor + list
    // container. Both recording and playback state use it; the only
    // differences are the callbacks (which subsystem owns the data) and
    // whether clicking a tag jumps to its frame (playback only).
    //
    // renderTagList(blockEl, tags, currentFrame) repaints the list portion
    // — called from refreshFooter on each refresh.
    const buildTagBlock = ({
        buttonLabel,
        inputPlaceholder,
        listId,
        onSubmit,
        onDelete,
        onUpdateComment,
        onJumpTo,
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
        addBtn.style.alignSelf = 'flex-start';
        addBtn.style.background = 'transparent';
        addBtn.style.border = '1px solid #4a7cff';
        addBtn.style.color = '#5da9ff';

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
        list._handlers = { onDelete, onUpdateComment, onJumpTo };

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
            // Non-current-frame tags fade like log history entries — only
            // the one(s) anchored at the current frame are at full prominence.
            const opacity = isCurrent ? '1' : '0.45';
            row.setAttribute('style', [
                'display: grid',
                'grid-template-columns: 4px 1fr auto',
                'gap: 8px',
                'padding: 6px 8px',
                'border-radius: 4px',
                'background: ' + (isCurrent ? 'rgba(74, 124, 255, 0.12)' : 'rgba(255, 255, 255, 0.025)'),
                'border-left: 3px solid ' + color,
                'opacity: ' + opacity,
                'cursor: ' + (handlers.onJumpTo ? 'pointer' : 'default')
            ].join(';'));
            if (handlers.onJumpTo) {
                row.addEventListener('click', () => handlers.onJumpTo(tag.frameIndex));
            }

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
            if (!tag.comment && !isOwn) comment.style.color = '#6c7588';
            else if (!tag.comment && isOwn) comment.style.color = '#6c7588';
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

        // Account group — one-time setup to link this extension install to
        // a karabuddy account. Bridges anonymous extension uploads into a
        // signed-in user's "My replays" list, and makes future uploads
        // auto-attribute.
        const accountGroup = document.createElement('div');
        accountGroup.setAttribute('style', sectionStyle + 'border-top: 1px solid #2e333c;');
        const accountLabel = document.createElement('div');
        accountLabel.setAttribute('style', sectionLabelStyle);
        accountLabel.textContent = 'Account';
        const accountDesc = document.createElement('div');
        accountDesc.setAttribute('style', 'font-size: 12px; color: #a0a8b8; line-height: 1.5;');
        accountDesc.textContent = 'Link this extension to your karabuddy account so uploaded replays appear under your name.';
        const linkAccountBtn = makeFooterBtn('Link to karabuddy', () => {
            B().openKarabuddyClaim().catch((err) =>
                console.error('[karabuddy] failed to open claim:', err)
            );
        });
        linkAccountBtn.style.alignSelf = 'flex-start';
        accountGroup.appendChild(accountLabel);
        accountGroup.appendChild(accountDesc);
        accountGroup.appendChild(linkAccountBtn);

        idleSection.appendChild(replaysGroup);
        idleSection.appendChild(recentGroup);
        idleSection.appendChild(soloGroup);
        idleSection.appendChild(accountGroup);

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

        // --- Recording state: REC status + tagging controls.
        const recSection = document.createElement('div');
        recSection.dataset.showState = 'recording';
        recSection.setAttribute('style', 'display: flex; flex-direction: column; gap: 12px;');
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
        recHint.textContent = 'Saved to the replay browser when the game ends.';
        const recTagBlock = buildTagBlock({
            buttonLabel: '+ Tag moment',
            inputPlaceholder: 'Optional comment for this moment…',
            listId: 'karabast-replays-rec-tag-list',
            onSubmit: (comment) => R().addTag(comment),
            onDelete: (id) => R().deleteTag(id),
            onUpdateComment: (id, comment) => R().updateTagComment(id, comment),
            // No jump-to-frame in recording (we're at the head).
            onJumpTo: null,
            getCurrentAuthor: () => D().getOrCreateAuthor(R().getCurrentPlayers()),
            getPlayerUsernames: () => R().getPlayerUsernames()
        });
        recSection.appendChild(recStatus);
        recSection.appendChild(recHint);
        recSection.appendChild(recTagBlock);

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

        // Tag nav row: jump to prev/next tag + download annotated file.
        const tagNavRow = document.createElement('div');
        tagNavRow.setAttribute('style', 'display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 4px;');
        const prevTagBtn = makeFooterBtn('‹ Prev tag', () => P().jumpToAdjacentTag(-1));
        prevTagBtn.id = 'karabast-replays-prev-tag';
        prevTagBtn.title = 'Jump to the previous tag ([)';
        prevTagBtn.style.background = 'transparent';
        prevTagBtn.style.border = '1px solid #4a4e56';
        prevTagBtn.style.color = '#a0a8b8';
        const nextTagBtn = makeFooterBtn('Next tag ›', () => P().jumpToAdjacentTag(1));
        nextTagBtn.id = 'karabast-replays-next-tag';
        nextTagBtn.title = 'Jump to the next tag (])';
        nextTagBtn.style.background = 'transparent';
        nextTagBtn.style.border = '1px solid #4a4e56';
        nextTagBtn.style.color = '#a0a8b8';
        const downloadBtn = makeFooterBtn('⬇ Download', () => P().downloadCurrent());
        downloadBtn.title = 'Download this replay (with any tags you added)';
        downloadBtn.style.background = 'transparent';
        downloadBtn.style.border = '1px solid #4a4e56';
        downloadBtn.style.color = '#a0a8b8';
        tagNavRow.appendChild(prevTagBtn);
        tagNavRow.appendChild(nextTagBtn);
        tagNavRow.appendChild(downloadBtn);

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

        const playbackTagBlock = buildTagBlock({
            buttonLabel: '+ Tag this frame',
            inputPlaceholder: 'Your note about this moment…',
            listId: 'karabast-replays-playback-tag-list',
            onSubmit: (comment) => P().addTag(comment),
            onDelete: (id) => P().deleteTag(id),
            onUpdateComment: (id, comment) => P().updateTagComment(id, comment),
            onJumpTo: (i) => P().jumpTo(i),
            getCurrentAuthor: () => D().getOrCreateAuthor(P().getCurrentPlayers()),
            getPlayerUsernames: () => P().getPlayerUsernames()
        });

        playbackSection.appendChild(frameLabel);
        playbackSection.appendChild(btnRow);
        playbackSection.appendChild(tagNavRow);
        playbackSection.appendChild(stepBlock);
        playbackSection.appendChild(playbackTagBlock);

        header.appendChild(title);
        header.appendChild(idleSection);
        header.appendChild(soloSection);
        header.appendChild(recSection);
        header.appendChild(playbackSection);
        header.appendChild(fileInput);

        // Body: log (only meaningful in playback).
        const panel = document.createElement('div');
        panel.id = 'karabast-replays-footer-panel';
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
        // Tag callout — rendered above the log when the current frame has
        // any tags. Populated in refreshFooter from replayState.tags.
        const tagCallout = document.createElement('div');
        tagCallout.id = 'karabast-replays-tag-callout';
        tagCallout.setAttribute('style', 'display: none; flex-direction: column; gap: 6px; margin-bottom: 10px;');

        const logBody = document.createElement('div');
        logBody.id = 'karabast-replays-footer-log';
        logBody.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 1.4;');

        panel.appendChild(tagCallout);
        panel.appendChild(logHeader);
        panel.appendChild(logBody);

        // preview span (used to flatten log entries for the collapsed view)
        const preview = document.createElement('span');
        preview.id = 'karabast-replays-footer-preview';
        preview.style.display = 'none';

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
        el.appendChild(preview);
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
    const buildLauncher = () => {
        const b = document.createElement('button');
        b.id = 'karabast-replays-launcher';
        b.type = 'button';
        b.title = 'Open KaraBuddy';
        b.setAttribute('style', [
            'position: fixed',
            'top: 10px',
            'left: 10px',
            'z-index: 2147483646',
            'width: 42px',
            'height: 42px',
            'border-radius: 10px',
            'background: linear-gradient(140deg, #243044 0%, #1a1d23 100%)',
            'border: 1px solid rgba(74, 124, 255, 0.5)',
            'padding: 0',
            'cursor: pointer',
            'box-shadow: 0 2px 12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0,0,0,0.3)',
            'display: none',
            'align-items: center',
            'justify-content: center',
            'transition: transform 120ms ease, border-color 120ms ease'
        ].join(';'));
        b.addEventListener('mouseenter', () => {
            b.style.transform = 'scale(1.06)';
            b.style.borderColor = 'rgba(90, 140, 255, 0.85)';
        });
        b.addEventListener('mouseleave', () => {
            b.style.transform = '';
            b.style.borderColor = 'rgba(74, 124, 255, 0.5)';
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
        b.addEventListener('click', () => setPanelCollapsed(false));
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

        // Show/hide state-conditional sections (header, body, footer).
        const state = currentPanelState();
        el.dataset.state = state;
        for (const c of el.querySelectorAll('[data-show-state]')) {
            const states = c.dataset.showState.split(/\s+/);
            c.style.display = states.includes(state) ? '' : 'none';
        }

        // Recording-state label.
        const recCount = R().getRecordingLength();
        const recLabel = document.getElementById('karabast-replays-footer-rec-label');
        if (recLabel) recLabel.textContent = `Recording — ${recCount} events`;

        // Launcher recording badge — visible whenever the recorder is
        // active, regardless of whether the launcher itself is currently
        // shown (it'll appear the moment the user collapses the sidebar).
        const launcherRec = document.getElementById('karabast-replays-launcher-rec');
        if (launcherRec) launcherRec.style.display = state === 'recording' ? 'block' : 'none';

        // Repaint tag lists based on which state's section is visible.
        // Author resolution uses live players from whichever subsystem owns
        // the data so tags created under a real karabast username register
        // as own-author for edit/delete affordances. Color is derived from
        // the player roster (green = player, yellow = reviewer).
        if (state === 'recording') {
            const currentAuthor = D().getOrCreateAuthor(R().getCurrentPlayers());
            const playerUsernames = R().getPlayerUsernames();
            const recList = document.getElementById('karabast-replays-rec-tag-list');
            renderTagList(recList, R().getTags(), R().getCurrentFrameIndex(), currentAuthor, playerUsernames);
        } else if (state === 'playback') {
            const currentAuthor = D().getOrCreateAuthor(P().getCurrentPlayers());
            const playerUsernames = P().getPlayerUsernames();
            const pbList = document.getElementById('karabast-replays-playback-tag-list');
            const pbTags = P().replayState.tags;
            const pbFrame = P().replayState.currentIndex;
            renderTagList(pbList, pbTags, pbFrame, currentAuthor, playerUsernames);

            // Prev/Next tag button enabled state — visually dim when there's
            // nothing to navigate to in that direction.
            const sortedFrames = pbTags.map((t) => t.frameIndex).sort((a, b) => a - b);
            const hasPrev = sortedFrames.some((i) => i < pbFrame);
            const hasNext = sortedFrames.some((i) => i > pbFrame);
            const prevBtn = document.getElementById('karabast-replays-prev-tag');
            const nextBtn = document.getElementById('karabast-replays-next-tag');
            if (prevBtn) prevBtn.style.opacity = hasPrev ? '1' : '0.4';
            if (nextBtn) nextBtn.style.opacity = hasNext ? '1' : '0.4';

            // Current-frame tag callout: full-size display of any tag(s)
            // anchored at the current playback frame, rendered above the log.
            const callout = document.getElementById('karabast-replays-tag-callout');
            if (callout) {
                callout.innerHTML = '';
                const atFrame = pbTags.filter((t) => t.frameIndex === pbFrame);
                if (atFrame.length === 0) {
                    callout.style.display = 'none';
                } else {
                    callout.style.display = 'flex';
                    for (const tag of atFrame) {
                        const tagColor = D().playerColorFor(tag.author, playerUsernames);
                        const card = document.createElement('div');
                        card.setAttribute('style', [
                            'padding: 8px 10px',
                            'border-radius: 6px',
                            'background: rgba(255, 255, 255, 0.04)',
                            'border-left: 4px solid ' + tagColor,
                            'display: flex',
                            'flex-direction: column',
                            'gap: 4px'
                        ].join(';'));
                        const head = document.createElement('div');
                        head.setAttribute('style', `font: 600 11px -apple-system, BlinkMacSystemFont, sans-serif; color: ${tagColor}; text-transform: uppercase; letter-spacing: 0.05em;`);
                        head.textContent = `${tag.author}'s note`;
                        const body = document.createElement('div');
                        body.setAttribute('style', 'font-size: 13px; color: #e6e6e6; line-height: 1.4; white-space: pre-wrap;');
                        body.textContent = tag.comment || '(no comment)';
                        if (!tag.comment) body.style.color = '#6c7588';
                        card.appendChild(head);
                        card.appendChild(body);
                        callout.appendChild(card);
                    }
                }
            }
        }

        // Contextual exit button — label + handler change with state.
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

        // Populate the replay browser whenever idle is on screen. Cheap to call
        // repeatedly — IDB is fast and the list rarely changes between calls.
        if (state === 'idle') refreshReplayBrowser();

        if (state !== 'playback') return;

        const frameEl = document.getElementById('karabast-replays-footer-frame');
        if (frameEl) {
            frameEl.textContent = `Frame ${rs.currentIndex + 1} / ${rs.frames.length}`;
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
