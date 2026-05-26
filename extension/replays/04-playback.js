// karabuddy.replays.Playback — PlaybackEngine + fake socket.io transport.
//
// Owns:
//   - replayState (loaded frames + cursor + cached React socket)
//   - The fake socket.io polling transport (active only under extReplay=1)
//   - FakeWebSocket class + WebSocket Proxy (top-level install)
//   - Direct React-listener dispatch (findKarabastSocket / directDispatch)
//   - Frame stepping (pushFrame / advance / setMode / jumpTo)
//   - File-loading entry points (enterPlaybackMode / loadReplayFromFile /
//     startPlayback / initReplayFromSession)
(() => {
    const NS = ((window.__KaraBuddy ||= {}).replays ||= {});
    const { REPLAY_FLAG, SOLO_MODE, SESSION_KEY } = NS.flags;
    const D = () => NS.Decoder;
    const F = () => NS.Footer;
    const B = () => NS.bridge;
    const R = () => NS.Recorder;

    // ----- replayState: what's loaded + where the cursor is -----
    const replayState = {
        loaded: false,
        frames: null,
        sideEvents: null,
        activeByFrame: null,
        messagesByFrame: null,
        meta: null,
        currentIndex: 0,
        // Parsed replay payload — kept around so tag edits can be
        // re-serialized into the .karareplay file when sharing.
        payload: null,
        gameId: null,
        tags: [],
        mode: (() => {
            try {
                const v = localStorage.getItem('karabast-replays-mode');
                if (v === 'action' || v === 'frame') return v;
            } catch {}
            return 'action';
        })()
    };

    // ----- Fake socket.io polling transport (extReplay=1 only) -----
    // We hijack all XHRs to karabast's /ws/ path and answer them ourselves
    // with engine.io packets, advertising no websocket upgrade so socket.io
    // never tries to leave polling.
    const fakePolling = {
        sid: null,
        pendingPolls: [],
        queue: [],
        sioReady: false
    };

    const respondXHR = (xhr, status, body) => {
        try {
            Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(xhr, 'status', { value: status, configurable: true });
            Object.defineProperty(xhr, 'statusText', { value: status === 200 ? 'OK' : 'Error', configurable: true });
            Object.defineProperty(xhr, 'responseText', { value: body, configurable: true });
            Object.defineProperty(xhr, 'response', { value: body, configurable: true });
        } catch {}
        const fire = (name) => {
            xhr.dispatchEvent(new ProgressEvent(name));
            const handler = xhr['on' + name];
            if (typeof handler === 'function') handler.call(xhr, new ProgressEvent(name));
        };
        fire('readystatechange');
        fire('load');
        fire('loadend');
    };

    const flushPoll = () => {
        if (fakePolling.pendingPolls.length === 0 || fakePolling.queue.length === 0) {
            return;
        }
        const body = fakePolling.queue.join('');
        fakePolling.queue.length = 0;
        const polls = fakePolling.pendingPolls.slice();
        fakePolling.pendingPolls.length = 0;
        for (const xhr of polls) respondXHR(xhr, 200, body);
    };

    const enqueuePacket = (packet) => {
        fakePolling.queue.push(packet);
        flushPoll();
    };

    const handleFakePoll = (xhr, method, url, body) => {
        const u = new URL(url, location.origin);
        const sid = u.searchParams.get('sid');

        if (method === 'POST') {
            const text = typeof body === 'string' ? body : '';
            NS.dlog('[karabuddy] handleFakePoll POST sid=', sid,
                'bodyType=', typeof body,
                'bodyLen=', text.length,
                'body=', JSON.stringify(text.slice(0, 80)));
            // engine.io v4 separates concatenated packets with U+001E
            const packets = text.split('\x1e');
            for (const pkt of packets) {
                if (!pkt) continue;
                if (pkt === '40' || pkt.startsWith('40')) {
                    const sioSid = 'replay-sio-' + Math.random().toString(36).slice(2, 10);
                    enqueuePacket('40' + JSON.stringify({ sid: sioSid }));
                    fakePolling.sioReady = true;
                    NS.dlog('[karabuddy] socket.io handshake — sid', sioSid);
                    // Backup push to the freshly-connected socket; the primary
                    // delivery path is direct dispatch in pushFrame().
                    if (replayState.loaded) {
                        queueMicrotask(() => pushFrame(replayState.currentIndex));
                    }
                }
            }
            respondXHR(xhr, 200, 'ok');
            return;
        }

        // GET
        if (!sid) {
            fakePolling.sid = 'replay-eio-' + Math.random().toString(36).slice(2, 10);
            const open = {
                sid: fakePolling.sid,
                upgrades: [],
                pingInterval: 300000,
                pingTimeout: 600000,
                maxPayload: 1000000
            };
            respondXHR(xhr, 200, '0' + JSON.stringify(open));
            return;
        }

        fakePolling.pendingPolls.push(xhr);
        flushPoll();
    };

    if (REPLAY_FLAG) {
        NS.dlog('[karabuddy] REPLAY_FLAG on — installing fake transport');

        // Seed anonymousUserId so karabast's GameProvider can create a socket
        // immediately. Without this, karabast's createNewSocket returns early
        // until its async user-init flow finishes setting one.
        try {
            if (!localStorage.getItem('anonymousUserId')) {
                const id = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
                localStorage.setItem('anonymousUserId', id);
                NS.dlog('[karabuddy] seeded anonymousUserId for playback:', id);
            } else {
                NS.dlog('[karabuddy] anonymousUserId already present:', localStorage.getItem('anonymousUserId'));
            }
        } catch (e) { console.error('[karabuddy] anonymousUserId seed failed:', e); }

        // NOOP-flush the held long-poll so the browser doesn't drop the idle XHR.
        setInterval(() => {
            if (fakePolling.pendingPolls.length && fakePolling.queue.length === 0) {
                enqueuePacket('6');
            }
        }, 25000);

        // Server-side engine.io ping. Without it the client eventually decides
        // the connection is dead and tears the socket down.
        setInterval(() => {
            if (fakePolling.sioReady) enqueuePacket('2');
        }, 20000);

        const OrigOpen = XMLHttpRequest.prototype.open;
        const OrigSend = XMLHttpRequest.prototype.send;
        const isWsUrl = (url) =>
            typeof url === 'string' && url.includes('karabast.net') && url.includes('/ws/?');

        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            if (typeof url === 'string' && url.includes('karabast.net')) {
                NS.dlog('[karabuddy] XHR open:', method, url.slice(0, 120));
            }
            if (isWsUrl(url)) {
                this._replayFake = { method, url };
                return;
            }
            return OrigOpen.call(this, method, url, ...rest);
        };

        XMLHttpRequest.prototype.send = function (body) {
            const meta = this._replayFake;
            if (meta) {
                queueMicrotask(() => handleFakePoll(this, meta.method, meta.url, body));
                return;
            }
            return OrigSend.call(this, body);
        };

        // Mock cosmetics so the GameBoard doesn't crash on undefined background
        // when the viewer isn't logged in to karabast.net.
        const OrigFetch = window.fetch;
        const COSMETICS_MOCK = {
            success: true,
            cosmetics: [
                { id: 'default-bg', title: 'Default', type: 'background', path: '/default-background.webp' },
                { id: 'default-cb', title: 'Default', type: 'cardback', path: '/default-cardback.webp' }
            ],
            count: 2,
            isContributor: false
        };
        window.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : input?.url || '';
            if (url.includes('karabast.net') && url.includes('/api/cosmetics')) {
                return Promise.resolve(new Response(JSON.stringify(COSMETICS_MOCK), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                }));
            }
            return OrigFetch.call(this, input, init);
        };
    }

    // ----- FakeWebSocket: socket.io v4 client compatibility shim. -----
    class FakeWebSocket extends EventTarget {
        constructor(url, protocols) {
            super();
            this.url = url;
            this.readyState = 0;
            this.binaryType = 'blob';
            this.protocol = Array.isArray(protocols) ? protocols[0] || '' : protocols || '';
            this.extensions = '';
            this.onopen = null;
            this.onmessage = null;
            this.onerror = null;
            this.onclose = null;
            this._sioConnected = false;
            this._isUpgrade = /[?&]sid=/.test(url);

            queueMicrotask(() => {
                this.readyState = 1;
                this._emit(new Event('open'));
                if (this._isUpgrade) {
                    // Upgrade path: engine.io session already established over polling;
                    // wait for client to send `2probe`, then `5` to commit the upgrade.
                    return;
                }
                const sid = 'replay-eio-' + Math.random().toString(36).slice(2, 10);
                const config = {
                    sid,
                    upgrades: [],
                    pingInterval: 25000,
                    pingTimeout: 20000,
                    maxPayload: 1000000
                };
                this._emitMessage('0' + JSON.stringify(config));
            });
        }

        _markReady() {
            if (this._sioConnected) return;
            this._sioConnected = true;
            if (replayState.loaded) pushFrame(0);
        }

        send(data) {
            if (typeof data !== 'string') return;
            if (data === '2') { this._emitMessage('3'); return; }
            if (data === '3') return;
            if (data === '2probe') { this._emitMessage('3probe'); return; }
            if (data === '5') {
                queueMicrotask(() => this._markReady());
                return;
            }
            if (data[0] === '4' && data[1] === '0') {
                const sioSid = 'replay-sio-' + Math.random().toString(36).slice(2, 10);
                queueMicrotask(() => {
                    this._emitMessage('40' + JSON.stringify({ sid: sioSid }));
                    this._markReady();
                });
                return;
            }
        }

        close(code, reason) {
            if (this.readyState >= 2) return;
            this.readyState = 3;
            this._emit(new CloseEvent('close', { code: code || 1000, reason: reason || '' }));
        }

        _emit(event) {
            this.dispatchEvent(event);
            const handler = this['on' + event.type];
            if (typeof handler === 'function') handler.call(this, event);
        }

        _emitMessage(data) {
            this._emit(new MessageEvent('message', { data }));
        }

        pushEvent(name, ...args) {
            this._emitMessage('42' + JSON.stringify([name, ...args]));
        }
    }
    FakeWebSocket.CONNECTING = 0;
    FakeWebSocket.OPEN = 1;
    FakeWebSocket.CLOSING = 2;
    FakeWebSocket.CLOSED = 3;

    const OrigWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(OrigWebSocket, {
        construct(target, args) {
            const url = args[0];
            const isKarabast = typeof url === 'string' && /karabast\.net/.test(url);
            if (REPLAY_FLAG && isKarabast) {
                return new FakeWebSocket(url, args[1]);
            }
            const ws = Reflect.construct(target, args);
            if (isKarabast && !SOLO_MODE) {
                // Recorder may not be loaded yet at construction time, but every
                // karabast WebSocket is created well after document_start finishes
                // loading all content scripts. Lazy lookup keeps the cycle safe.
                R()?.attachInterceptor?.(ws);
            }
            return ws;
        }
    });

    // ----- Direct dispatch: bypass socket.io, call the React listener. -----
    const dismissEndGameModal = () => {
        // Karabast opens the GAME ENDED modal when gameState.winners is populated
        // but doesn't auto-close when stepping back to a winners-empty frame.
        const heading = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
            .find((h) => /^game ended$/i.test((h.textContent || '').trim()));
        if (!heading) return;
        let modal = heading;
        for (let i = 0; i < 30 && modal && modal !== document.body; i++) {
            const inside = modal.querySelectorAll('button, [role="button"], svg');
            for (const el of inside) {
                const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                if (aria.includes('close')) {
                    el.closest('button, [role="button"]')?.click?.() ?? el.click();
                    return;
                }
            }
            modal = modal.parentElement;
        }
    };

    // Walk React fiber tree to find karabast's socket. Game.context.tsx stores
    // it via setSocket() — we read it directly from a fiber memoizedState chain.
    // Cached once found; re-find if it's gone or returns null.
    const findKarabastSocket = () => {
        if (replayState.cachedSocket && replayState.cachedSocket.connected !== false) {
            return replayState.cachedSocket;
        }
        const root = document.querySelector('body');
        if (!root) return null;
        const stack = [root];
        const seen = new WeakSet();
        while (stack.length) {
            const el = stack.pop();
            if (!el || seen.has(el)) continue;
            seen.add(el);
            const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
            if (fiberKey) {
                let fiber = el[fiberKey];
                while (fiber) {
                    let hook = fiber.memoizedState;
                    while (hook) {
                        const v = hook.memoizedState;
                        if (v && typeof v === 'object' && typeof v.on === 'function'
                            && typeof v.emit === 'function' && typeof v.disconnect === 'function'
                            && Array.isArray(v.listeners?.('gamestate'))) {
                            replayState.cachedSocket = v;
                            return v;
                        }
                        hook = hook.next;
                    }
                    fiber = fiber.return;
                }
            }
            for (const child of el.children || []) stack.push(child);
        }
        return null;
    };

    const directDispatchGamestate = (state) => {
        const socket = findKarabastSocket();
        if (!socket) {
            NS.dlog('[karabuddy] direct dispatch: no socket in React fiber yet');
            return false;
        }
        const listeners = socket.listeners('gamestate');
        if (!listeners || listeners.length === 0) {
            NS.dlog('[karabuddy] direct dispatch: socket found, 0 gamestate listeners');
            return false;
        }
        for (const handler of listeners) {
            try { handler(state); } catch (err) {
                console.error('[karabuddy] gamestate handler threw:', err);
            }
        }
        NS.dlog(`[karabuddy] direct dispatch: fired ${listeners.length} listener(s)`);
        return true;
    };

    // ----- Frame stepping -----
    const pushFrame = (index) => {
        if (!replayState.loaded) return;
        if (index < 0 || index >= replayState.frames.length) return;
        const prevIndex = replayState.currentIndex;
        if (prevIndex !== index) {
            replayState.lastTransition = { from: prevIndex, to: index };
        }
        replayState.currentIndex = index;
        const state = replayState.frames[index].state;
        // Primary path: invoke karabast's gamestate listener directly via the
        // React-tracked socket. Falls back to the socket.io polling transport
        // push only if the fiber walk hasn't found the socket yet.
        const direct = directDispatchGamestate(state);
        if (!direct) {
            if (fakePolling.sioReady) {
                NS.dlog(`[karabuddy] pushFrame ${index}: fallback enqueue (sioReady=true, polls=${fakePolling.pendingPolls.length})`);
                enqueuePacket('42' + JSON.stringify(['gamestate', state]));
            } else {
                NS.dlog(`[karabuddy] pushFrame ${index}: no delivery (direct failed, sioReady=false)`);
            }
        }
        const prevHadWinners = prevIndex >= 0 && (replayState.frames[prevIndex]?.state?.winners?.length || 0) > 0;
        const nowHasWinners = (state.winners?.length || 0) > 0;
        if (prevHadWinners && !nowHasWinners) {
            setTimeout(dismissEndGameModal, 50);
        }
        F()?.refreshOverlay?.();
    };

    const advanceByFrame = (delta) => {
        const dir = delta > 0 ? 1 : -1;
        const next = Math.max(0, Math.min(replayState.frames.length - 1, replayState.currentIndex + dir));
        if (next !== replayState.currentIndex) pushFrame(next);
    };

    const advanceByAction = (delta) => {
        const dir = delta > 0 ? 1 : -1;
        const total = replayState.frames.length;
        let i = replayState.currentIndex;
        const cur = replayState.activeByFrame?.[i];
        let next = i + dir;
        while (next >= 0 && next < total && replayState.activeByFrame?.[next] === cur) next += dir;
        if (next < 0 || next >= total) {
            next = dir > 0 ? total - 1 : 0;
        }
        if (next !== replayState.currentIndex) pushFrame(next);
    };

    const advance = (delta, modeOverride) => {
        if (!replayState.loaded) return;
        const mode = modeOverride || replayState.mode;
        if (mode === 'action' && replayState.activeByFrame) {
            advanceByAction(delta);
        } else {
            advanceByFrame(delta);
        }
    };

    const setMode = (mode) => {
        if (mode !== 'action' && mode !== 'frame') return;
        if (replayState.mode === mode) return;
        replayState.mode = mode;
        try { localStorage.setItem('karabast-replays-mode', mode); } catch {}
        F()?.refreshOverlay?.();
    };

    const jumpTo = (index) => {
        if (!replayState.loaded) return;
        const clamped = Math.max(0, Math.min(replayState.frames.length - 1, index));
        pushFrame(clamped);
    };

    // ----- File-loading entry points -----
    const enterPlaybackMode = (rawText) => {
        try {
            sessionStorage.setItem(SESSION_KEY, rawText);
        } catch (err) {
            console.error('[karabuddy] failed to stash replay in sessionStorage:', err);
            alert('Replay too large for sessionStorage. Try a smaller recording.');
            return;
        }
        location.href = `${location.origin}/GameBoard?spectator=true&extReplay=1`;
    };

    const loadReplayFromFile = (file) => {
        const reader = new FileReader();
        reader.onload = () => {
            const text = reader.result;
            try {
                const parsed = JSON.parse(text);
                const result = D().decodeReplay(parsed);
                window.__karabastReplay = result;
                console.log(
                    `[karabuddy] decoded ${result.frames.length} frames, ${result.sideEvents.length} side events from ${file.name}`
                );
                // Save to the replay browser so loading a file from disk also
                // populates the IDB. gameId is the natural dedupe key, so
                // re-loading the same file is a no-op upsert.
                const { gameId, players } = D().extractMetaFromFile(parsed);
                if (gameId) {
                    const startedAt = parsed.startedAt
                        ? Date.parse(parsed.startedAt) || Date.now()
                        : Date.now();
                    B().saveReplay({
                        gameId,
                        savedAt: Date.now(),
                        startedAt,
                        durationMs: parsed.durationMs || 0,
                        actionCount: parsed.actionCount,
                        filename: file.name,
                        players,
                        payload: text
                    });
                }
                enterPlaybackMode(text);
            } catch (err) {
                console.error('[karabuddy] decode failed:', err);
                alert(`Failed to decode replay: ${err.message}`);
            }
        };
        reader.onerror = () => alert('Failed to read replay file.');
        reader.readAsText(file);
    };

    const startPlayback = (text) => {
        try {
            const parsed = JSON.parse(text);
            const result = D().decodeReplay(parsed);
            // Tags are stored on the parsed payload as an additive top-level
            // field. Old replays without tags get an empty array. We keep
            // both the parsed payload and a direct ref to its tags array so
            // edits mutate the source of truth before re-serializing.
            if (!Array.isArray(parsed.tags)) parsed.tags = [];
            Object.assign(replayState, {
                loaded: true,
                frames: result.frames,
                sideEvents: result.sideEvents,
                activeByFrame: result.activeByFrame,
                messagesByFrame: result.messagesByFrame,
                meta: result.meta,
                currentIndex: 0,
                payload: parsed,
                gameId: parsed?.events?.find((e) => e.event === 'gamestate' && e.args?.[0]?.full)?.args?.[0]?.full?.id || null,
                tags: parsed.tags
            });
            window.__karabastReplay = result;
            console.log(`[karabuddy] playback ready — ${result.frames.length} frames, ${parsed.tags.length} tags`);
            pushFrame(0);
        } catch (err) {
            console.error('[karabuddy] failed to restore replay:', err);
        }
    };

    const initReplayFromSession = async () => {
        if (!REPLAY_FLAG) return;
        // The URL is canonical when present: extReplayId means the replays
        // page launched us pointing at a specific entry. Tabs are reused
        // across replays, so sessionStorage may still hold the previous
        // replay — checking extReplayId first prevents loading the wrong file.
        const extReplayId = new URLSearchParams(location.search).get('extReplayId');
        if (extReplayId) {
            try {
                const entry = await B().consumePendingReplay(extReplayId);
                if (!entry || !entry.payload) {
                    console.warn('[karabuddy] no pending payload for', extReplayId);
                    return;
                }
                sessionStorage.setItem(SESSION_KEY, entry.payload);
                startPlayback(entry.payload);
            } catch (err) {
                console.error('[karabuddy] failed to fetch pending replay:', err);
            }
            return;
        }
        // No extReplayId → file-picker / drag-drop flow stashed the payload
        // in sessionStorage. Survives refreshes.
        const text = sessionStorage.getItem(SESSION_KEY);
        if (text) {
            startPlayback(text);
            return;
        }
        console.warn('[karabuddy] extReplay flag set but no payload available');
    };

    // ----- Tag API (playback side) -----
    //
    // Tags during playback edit the in-memory parsed payload. Every change
    // re-serializes the payload and pushes it back to IDB so the replay
    // browser keeps the latest annotations even after a page reload. The
    // download-with-tags path simply serializes the same parsed payload.

    const persistPayload = () => {
        const p = replayState.payload;
        const id = replayState.gameId;
        if (!p || !id) return;
        const text = JSON.stringify(p);
        sessionStorage.setItem(SESSION_KEY, text);
        const meta = D().extractMetaFromFile(p).players;
        B().saveReplay({
            gameId: id,
            savedAt: Date.now(),
            startedAt: p.startedAt ? Date.parse(p.startedAt) || Date.now() : Date.now(),
            durationMs: p.durationMs || 0,
            actionCount: p.actionCount,
            filename: p.filename || D().buildReplayFilename(Date.now(), meta),
            players: meta,
            payload: text
        }).then(() => F()?.refreshOverlay?.());
    };

    const playerFromCurrentFrame = () => {
        const f = replayState.frames?.[replayState.currentIndex];
        return f?.state?.players || null;
    };

    const addTag = (comment = '') => {
        const d = D();
        const author = d.getOrCreateAuthor(playerFromCurrentFrame());
        const tag = {
            id: d.makeTagId(),
            frameIndex: replayState.currentIndex,
            author,
            comment: String(comment || ''),
            createdAt: Date.now()
        };
        replayState.tags.push(tag);
        persistPayload();
        F()?.refreshOverlay?.();
        return tag;
    };

    const updateTagComment = (id, comment) => {
        const tag = replayState.tags.find((t) => t.id === id);
        if (!tag) return null;
        tag.comment = String(comment || '');
        persistPayload();
        F()?.refreshOverlay?.();
        return tag;
    };

    const deleteTag = (id) => {
        const i = replayState.tags.findIndex((t) => t.id === id);
        if (i < 0) return false;
        replayState.tags.splice(i, 1);
        persistPayload();
        F()?.refreshOverlay?.();
        return true;
    };

    const tagsAtFrame = (i) =>
        replayState.tags.filter((t) => t.frameIndex === i);

    // Jump to the tag whose frameIndex is nearest in the given direction.
    // dir > 0 → next tag at frame > currentIndex; dir < 0 → previous.
    const jumpToAdjacentTag = (dir) => {
        if (!replayState.tags.length) return false;
        const sorted = replayState.tags
            .map((t) => t.frameIndex)
            .filter((i) => i >= 0 && i < (replayState.frames?.length || 0))
            .sort((a, b) => a - b);
        if (!sorted.length) return false;
        const cur = replayState.currentIndex;
        let target = null;
        if (dir > 0) target = sorted.find((i) => i > cur);
        else target = [...sorted].reverse().find((i) => i < cur);
        if (target == null) return false;
        jumpTo(target);
        return true;
    };

    // Download the current replay (with any added tags) as a .karareplay file.
    const downloadCurrent = () => {
        const p = replayState.payload;
        if (!p) return;
        const text = JSON.stringify(p);
        const meta = D().extractMetaFromFile(p).players;
        const filename = D().buildReplayFilename(Date.now(), meta);
        const blob = new Blob([text], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    NS.Playback = {
        replayState,
        pushFrame,
        advance,
        advanceByFrame,
        advanceByAction,
        setMode,
        jumpTo,
        enterPlaybackMode,
        loadReplayFromFile,
        startPlayback,
        initReplayFromSession,
        addTag,
        updateTagComment,
        deleteTag,
        tagsAtFrame,
        jumpToAdjacentTag,
        downloadCurrent,
        getCurrentPlayers: playerFromCurrentFrame,
        // Player set — pulled from the first gamestate's players map. Stable
        // for the whole replay, no need to re-sniff per frame.
        getPlayerUsernames: () => {
            const players = replayState.frames?.[0]?.state?.players;
            return D().playerUsernamesFromPlayers(players);
        }
    };
})();
