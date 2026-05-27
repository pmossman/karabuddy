// karabuddy.replays.Recorder — RecordingSession.
//
// Owns the live capture lifecycle: WebSocket interception, gamestate diffing,
// localStorage persistence across refresh, auto-download on game end, and the
// service-worker save call. Reads pure helpers from Decoder, talks to the
// store via bridge, and pokes Footer to repaint when state changes.
(() => {
    const NS = ((window.__KaraBuddy ||= {}).replays ||= {});
    const D = () => NS.Decoder;
    const F = () => NS.Footer;
    const B = () => NS.bridge;
    const T = () => NS.toast;

    // ----- Module state -----
    const recording = [];
    const tags = [];
    let gamestateCount = 0;          // anchor for "tag at this moment"
    let recordingStart = Date.now();
    let autoDownloadScheduled = false;
    let prevNormalizedGamestate = null;
    let lastFullGamestate = null;    // most recent full snapshot, for author sniffing
    let currentGameId = null;
    // Periodic snapshot uploads (B26): every 5 min during an active match the
    // recorder pushes the current payload to karabuddy.app. Server overwrites
    // the existing slug for this gameId. Mitigates tab-close / lobby-disconnect
    // / browser-crash data loss — without this, a replay only persists to
    // karabuddy.app at clean game-end.
    const PERIODIC_UPLOAD_INTERVAL_MS = 5 * 60 * 1000;
    let periodicUploadTimer = null;
    // After a successful auto-finalize, karabast often sends a couple more
    // gamestate events (cleanup, lobby return). They look like game-end and
    // would re-trigger scheduleAutoDownload on the SAME gameId, finalizing
    // a one-event "recording" that then fails the distinct-players check.
    // Track the just-finalized id and ignore further events for it; a new
    // gameId resets this and the next game records normally.
    let finalizedGameId = null;
    // karabuddy.com URL of the most recently uploaded replay for THIS
    // recording session. Surfaces in the launcher's expanded panel as a
    // "Open this replay on karabuddy →" link. Cleared at the start of every
    // new recording (first gamestate after a previous finalize / reset); set
    // inside the uploadReplay success branch below.
    let currentKarabuddyUrl = null;
    // ID of the player whose perspective this recording was captured from
    // (i.e. the local karabast user). Embedded in the upload payload so the
    // karabuddy.app viewer renders the right side at the bottom instead of
    // guessing via Object.keys(players)[0]. Captured on first gamestate.
    let localPlayerId = null;

    const resetRecording = () => {
        recording.length = 0;
        tags.length = 0;
        gamestateCount = 0;
        recordingStart = Date.now();
        prevNormalizedGamestate = null;
        lastFullGamestate = null;
        autoDownloadScheduled = false;
        localPlayerId = null;
        stopPeriodicUploads();
        // Note: currentKarabuddyUrl intentionally NOT cleared here — keeps
        // the "Open on karabuddy" link visible after a match finalizes
        // until the next gamestate of a new match starts (which clears it).
    };

    // ----- Persistence: mid-game refresh wipes the in-memory recording. -----
    // We snapshot it to localStorage (debounced) and try to restore on the
    // first gamestate of a fresh page load if its gameId matches.
    const PERSIST_KEY = 'karabast-replays-recording-state';
    let persistTimer = null;
    const persistRecording = () => {
        try {
            localStorage.setItem(PERSIST_KEY, JSON.stringify({
                gameId: currentGameId,
                recordingStart,
                recording,
                prevNormalizedGamestate,
                tags,
                gamestateCount
            }));
        } catch {
            // Quota or serialization failure — give up persistence for this game.
            try { localStorage.removeItem(PERSIST_KEY); } catch {}
        }
    };
    const schedulePersist = () => {
        if (persistTimer) return;
        persistTimer = setTimeout(() => {
            persistTimer = null;
            persistRecording();
        }, 500);
    };
    const clearPersistedRecording = () => {
        if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
        try { localStorage.removeItem(PERSIST_KEY); } catch {}
    };
    const tryRestorePersistedRecording = (incomingGameId) => {
        if (currentGameId !== null) return false;
        let data;
        try {
            const raw = localStorage.getItem(PERSIST_KEY);
            if (!raw) return false;
            data = JSON.parse(raw);
        } catch { return false; }
        if (!data || data.gameId !== incomingGameId || !Array.isArray(data.recording)) {
            clearPersistedRecording();
            return false;
        }
        recording.length = 0;
        recording.push(...data.recording);
        recordingStart = data.recordingStart || Date.now();
        prevNormalizedGamestate = data.prevNormalizedGamestate || null;
        tags.length = 0;
        if (Array.isArray(data.tags)) tags.push(...data.tags);
        gamestateCount = Number.isFinite(data.gamestateCount) ? data.gamestateCount : recording.filter((e) => e.event === 'gamestate').length;
        currentGameId = data.gameId;
        NS.dlog(`[karabuddy] resumed recording — ${recording.length} events, ${tags.length} tags for game ${incomingGameId}`);
        // Restored mid-game → resume periodic snapshots so the resumed-from
        // recording is still pushed to karabuddy.app on the regular cadence.
        startPeriodicUploads();
        return true;
    };

    // ----- record(dir, frame): the WebSocket interceptor feeds us packets. -----
    const record = (dir, frame) => {
        const d = D();
        if (frame.kind !== 'event') return;
        if (!d.RECORDED_EVENTS.has(frame.event)) return;

        if (frame.event === 'gamestate') {
            const original = frame.args[0];
            const incomingId = original.id || null;

            // Post-finalize cleanup events for the same gameId — ignore.
            // (If a new game starts, incomingId differs and we fall through
            // to the normal flow.)
            if (incomingId && incomingId === finalizedGameId) return;

            // First gamestate of this page load: maybe a mid-game refresh.
            // If localStorage has a persisted recording for the same gameId,
            // restore it so we continue the same file.
            if (incomingId && currentGameId === null) {
                tryRestorePersistedRecording(incomingId);
            }

            // New-game boundary: gameState.id changed. Finalize the previous
            // recording (auto-download if it had anything) and start fresh so
            // the next game writes to its own file. Hitting Requeue or rolling
            // straight into another match triggers this path.
            if (incomingId && currentGameId && incomingId !== currentGameId) {
                if (recording.length > 0) download('game-changed');
                resetRecording();
                clearPersistedRecording();
            }
            if (incomingId) currentGameId = incomingId;

            const t = Date.now() - recordingStart;
            const norm = d.normalizeGamestate(structuredClone(original));
            if (prevNormalizedGamestate === null) {
                recording.push({ t, dir, event: 'gamestate', args: [{ full: norm }] });
                prevNormalizedGamestate = norm;
                gamestateCount++;
                // First gamestate of this recording — clear the prior match's
                // karabuddy URL (if any) and surface a toast so the user knows
                // the recorder is live even with the launcher collapsed.
                currentKarabuddyUrl = null;
                T()?.show?.('Recording…', { kind: 'info' });
                startPeriodicUploads();
            } else {
                const patch = d.makePatch(prevNormalizedGamestate, norm);
                if (Object.keys(patch).length === 0) return;
                recording.push({ t, dir, event: 'gamestate', args: [{ patch }] });
                prevNormalizedGamestate = norm;
                gamestateCount++;
            }
            // Retry POV detection on every gamestate until we lock it in.
            // The first gamestate of a match may arrive before mulligan is
            // resolved (hands empty for both players), in which case
            // detectLocalPlayerId returns null and we try again next tick.
            if (localPlayerId === null) localPlayerId = detectLocalPlayerId(norm.players);
            // Keep a live full snapshot for author sniffing when a tag is added.
            lastFullGamestate = norm;
            if (d.looksLikeGameEnd(original)) scheduleAutoDownload();
        } else {
            const t = Date.now() - recordingStart;
            recording.push({ t, dir, event: frame.event, args: structuredClone(frame.args) });
        }
        schedulePersist();
        F()?.refreshOverlay?.();
    };

    // Walk the recorded events and tally how many distinct actions there were
    // (consecutive runs of the same active player) and how many distinct
    // players ever acted. Mirrors what the playback decoder would compute.
    const analyzeRecording = () => {
        let lastFull = null;
        let lastActive = null;
        let actionCount = 0;
        const activePlayers = new Set();
        for (const e of recording) {
            if (e.event !== 'gamestate') continue;
            const arg = e.args?.[0];
            if (!arg) continue;
            if (arg.full) lastFull = structuredClone(arg.full);
            else if (arg.patch && lastFull) D().applyPatch(lastFull, arg.patch);
            const players = lastFull?.players;
            if (!players) continue;
            let active = null;
            for (const pid of Object.keys(players)) {
                if (players[pid]?.isActionPhaseActivePlayer) { active = pid; break; }
            }
            if (active && active !== lastActive) {
                actionCount++;
                lastActive = active;
                activePlayers.add(active);
            }
        }
        return { actionCount, distinctActivePlayers: activePlayers.size };
    };

    // Detect which player ID in the gamestate corresponds to the local
    // karabast user (the one whose perspective this match was played from).
    // Karabast server-side-masks each client's view: the LOCAL player's
    // hand contains cards with full data (`.id` / `.setId`); the opponent's
    // hand contains stubs without that data (this is exactly the asymmetry
    // `lib/replayDecoder.ts:stripHiddenHandCards` was built to handle).
    // Whichever player has visible cards in hand is the recorder's POV —
    // works for anonymous and logged-in karabast users alike, and doesn't
    // depend on any karabast internal storage layout.
    const detectLocalPlayerId = (players) => {
        if (!players || typeof players !== 'object') return null;
        const withVisibleHand = [];
        for (const [pid, p] of Object.entries(players)) {
            const hand = p?.cardPiles?.hand;
            if (!Array.isArray(hand)) continue;
            if (hand.some((c) => c && (c.id || c.setId))) withVisibleHand.push(pid);
        }
        // Exactly one visible hand = unambiguous local POV. Zero or two
        // means hands were empty (very early game / between turns) or
        // we're in a spectator-style state where karabast sent full data
        // for both — in either case return null and try again on the next
        // gamestate.
        return withVisibleHand.length === 1 ? withVisibleHand[0] : null;
    };

    // Build the upload payload for the current recording state. Same shape
    // for finalize and periodic snapshots; the `reason` field distinguishes.
    const buildPayloadText = (reason, durationMs, actionCount) => {
        const d = D();
        return JSON.stringify({
            version: 2,
            url: location.href,
            startedAt: new Date(recordingStart).toISOString(),
            durationMs,
            reason,
            actionCount,
            localPlayerId,
            gamestateFormat: {
                note: 'gamestate events carry either {full: state} (initial/full snapshot) or {patch: {path: value, ...}} (overwrite leaf at slash-delimited path). Apply in order to reconstruct each frame.',
                strippedTopLevel: [...d.TOP_NOISE],
                strippedPerPlayer: [...d.PLAYER_NOISE]
            },
            events: recording,
            tags: tags.slice()
        });
    };

    // Periodic mid-match upload (B26). Fires every PERIODIC_UPLOAD_INTERVAL_MS
    // while a recording is active and has crossed the "worth keeping" threshold.
    // Silent: no toasts (don't interrupt play), no IDB save (only finalize
    // persists locally). Server overwrites the existing replay slug for this
    // gameId; the server's stale-snapshot guard rejects out-of-order writes
    // so a slow periodic that lands after finalize can't roll back state.
    const snapshotUpload = () => {
        if (gamestateCount === 0) return;
        const { actionCount, distinctActivePlayers } = analyzeRecording();
        if (distinctActivePlayers < 2) return;
        const durationMs = Date.now() - recordingStart;
        const payloadText = buildPayloadText('periodic', durationMs, actionCount);
        B().uploadReplay(payloadText).then((result) => {
            if (!result || !result.slug) return;
            if (result.staleSnapshot) return;
            // Cache the URL so the floating panel's "Open on karabuddy →"
            // link surfaces during the match, not just after game-end.
            currentKarabuddyUrl = result.url;
            F()?.refreshOverlay?.();
        });
    };

    const startPeriodicUploads = () => {
        if (periodicUploadTimer) return;
        periodicUploadTimer = setInterval(snapshotUpload, PERIODIC_UPLOAD_INTERVAL_MS);
    };

    function stopPeriodicUploads() {
        if (periodicUploadTimer) {
            clearInterval(periodicUploadTimer);
            periodicUploadTimer = null;
        }
    }

    // ----- download(): persist current recording. -----
    // reason === 'manual': save to IDB AND trigger a file download for sharing.
    // reason === 'auto' / 'game-changed': save to IDB only — no surprise file.
    // Recordings with fewer than 2 distinct active players are skipped entirely
    // (rage-quits / abandoned lobbies aren't worth keeping).
    const download = (reason) => {
        const d = D();
        const meta = d.extractReplayMeta(recording);
        const durationMs = Date.now() - recordingStart;
        const { actionCount, distinctActivePlayers } = analyzeRecording();
        const isManual = reason === 'manual';

        // Finalize-time uploads stop the periodic cadence; further snapshots
        // would race with the finalize write (the server's stale-snapshot
        // guard rejects them, but stopping the timer avoids the wasted call).
        stopPeriodicUploads();

        // Skip non-games unless the user explicitly asked. Manual still saves
        // so the user can pull a snapshot mid-game even if only one player
        // has acted so far.
        if (!isManual && distinctActivePlayers < 2) {
            NS.dlog(`[karabuddy] skipped save (${reason}) — only ${distinctActivePlayers} distinct active player(s)`);
            clearPersistedRecording();
            if (currentGameId) finalizedGameId = currentGameId;
            resetRecording();
            currentGameId = null;
            F()?.refreshOverlay?.();
            return;
        }

        const payloadText = buildPayloadText(reason, durationMs, actionCount);
        const filename = d.buildReplayFilename(Date.now(), meta);

        // Manual download → trigger a file save so the user can grab the file.
        if (isManual) {
            const blob = new Blob([payloadText], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }
        NS.dlog(`[karabuddy] finalized (${reason}) — ${recording.length} events, ${actionCount} actions, ${durationMs}ms`);

        // Capture everything the async upload .then() needs into locals.
        // The module-scope `currentGameId` / `recordingStart` get reset by
        // resetRecording() before the upload resolves, so reading them
        // lazily inside the .then would land null/0.
        const gameIdLocal = currentGameId;
        const recordingStartLocal = recordingStart;

        // Always stash in the service-worker IDB so the replays page lists it.
        if (gameIdLocal) {
            B().saveReplay({
                gameId: gameIdLocal,
                savedAt: Date.now(),
                startedAt: recordingStartLocal,
                durationMs,
                actionCount,
                filename,
                players: meta,
                payload: payloadText
            }).then(() => {
                F()?.refreshReplayBrowser?.();
                // Only toast for non-manual saves — a manual save already
                // triggers a file download which is its own feedback.
                if (!isManual) T()?.show?.('Replay saved', { kind: 'success' });
            });

            // Fire-and-forget upload to karabuddy.com. Doesn't block local
            // save; failure just leaves the replay local-only. On success
            // we patch the IDB entry with the hosted slug so the replays
            // browser can surface a "View on karabuddy" link.
            B().uploadReplay(payloadText).then((result) => {
                if (!result || !result.slug) {
                    // Suppress the generic toast when the bridge is dead
                    // because the extension was reloaded — 06-bootstrap
                    // already showed a persistent "refresh this tab"
                    // toast that explains the root cause.
                    if (!NS.contextInvalidated) {
                        T()?.show?.('Upload failed', { kind: 'error' });
                    }
                    return;
                }
                NS.dlog(`[karabuddy] uploaded to ${result.url}${result.deduped ? ' (already existed)' : ''}`);
                // Cache so the launcher's expanded panel can surface a
                // "Open this replay on karabuddy →" link until the next
                // recording starts.
                currentKarabuddyUrl = result.url;
                F()?.refreshOverlay?.();
                T()?.show?.('Replay uploaded', { kind: 'success', tooltip: result.url });
                B().saveReplay({
                    gameId: gameIdLocal,
                    savedAt: Date.now(),
                    startedAt: recordingStartLocal,
                    durationMs,
                    actionCount,
                    filename,
                    players: meta,
                    payload: payloadText,
                    karabuddySlug: result.slug,
                    karabuddyUrl: result.url
                }).then(() => F()?.refreshReplayBrowser?.());
            });
        }

        // The game we just persisted is in IDB now; don't restore it on the
        // next page load.
        clearPersistedRecording();

        // Reset in-memory state except for manual partial-downloads, so the
        // sidebar transitions out of recording once the game has actually
        // ended. Manual keeps recording intact so events keep streaming in.
        if (!isManual) {
            if (currentGameId) finalizedGameId = currentGameId;
            resetRecording();
            currentGameId = null;
            F()?.refreshOverlay?.();
        }
    };

    const scheduleAutoDownload = () => {
        if (autoDownloadScheduled) return;
        autoDownloadScheduled = true;
        setTimeout(() => download('auto'), 1500);
    };

    // ----- Tag API -----
    // addTag(comment?) anchors at the current frame (latest gamestate seen).
    // Returns the freshly-created tag so the UI can scroll to it / focus its
    // comment editor.
    const addTag = (comment = '') => {
        const d = D();
        const author = d.getOrCreateAuthor(lastFullGamestate?.players);
        const frameIndex = Math.max(0, gamestateCount - 1);
        // No color stored on the tag — derived at render time from author
        // vs the game's player roster so the scheme stays consistent when
        // replays change hands between players and reviewers.
        const tag = {
            id: d.makeTagId(),
            frameIndex,
            author,
            comment: String(comment || ''),
            createdAt: Date.now()
        };
        tags.push(tag);
        schedulePersist();
        F()?.refreshOverlay?.();
        T()?.show?.('Tag saved', { kind: 'success' });
        return tag;
    };

    const updateTagComment = (id, comment) => {
        const tag = tags.find((t) => t.id === id);
        if (!tag) return null;
        tag.comment = String(comment || '');
        schedulePersist();
        F()?.refreshOverlay?.();
        return tag;
    };

    const deleteTag = (id) => {
        const i = tags.findIndex((t) => t.id === id);
        if (i < 0) return false;
        tags.splice(i, 1);
        schedulePersist();
        F()?.refreshOverlay?.();
        return true;
    };

    // ----- attachInterceptor(ws): wire a real WebSocket up to the recorder. -----
    const attachInterceptor = (ws) => {
        ws.addEventListener('message', (e) => {
            const frame = D().parseEngineIoFrame(e.data);
            if (frame) record('in', frame);
        });
        const origSend = ws.send.bind(ws);
        ws.send = function (data) {
            const frame = D().parseEngineIoFrame(data);
            if (frame) record('out', frame);
            return origSend(data);
        };
    };

    // Install the WebSocket Proxy at module-load time so we catch karabast's
    // socket the moment the page code constructs it. (Karabast's bundle runs
    // AFTER document_start, by which point all content scripts have loaded.)
    // Pre-B20 this lived in 04-playback.js's FakeWebSocket setup; when that
    // file was deleted the recorder lost its only entry point. Restored here
    // so the recorder owns its own WebSocket lifecycle, simpler + correct.
    const OrigWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(OrigWebSocket, {
        construct(target, args) {
            const ws = Reflect.construct(target, args);
            const url = args[0];
            if (typeof url === 'string' && /karabast\.net/.test(url)) {
                // Lazy lookup — NS.Recorder is the exports object at the
                // bottom of this IIFE; safe by the time karabast's bundle
                // constructs its socket.
                NS.Recorder?.attachInterceptor?.(ws);
            }
            return ws;
        }
    });

    // Best-effort upload on tab close / navigation away (B29). Covers the
    // window between periodic snapshots — without this, closing the tab
    // within the first 5 min of a match loses the replay entirely from
    // karabuddy.app's perspective. Routes through the existing bridge →
    // service-worker → fetch path: the SW outlives the tab by ~30s in MV3,
    // long enough to complete the POST. Avoids navigator.sendBeacon's
    // cross-origin-JSON-preflight issue and fetch keepalive's 64KB cap.
    window.addEventListener('pagehide', () => {
        if (gamestateCount === 0) return;
        const { actionCount, distinctActivePlayers } = analyzeRecording();
        if (distinctActivePlayers < 2) return;
        const durationMs = Date.now() - recordingStart;
        const payloadText = buildPayloadText('pagehide', durationMs, actionCount);
        // Fire-and-forget — by the time the SW responds the page is gone
        // and the karabast-companion-result event has nowhere to land.
        B().uploadReplay(payloadText);
    });

    NS.Recorder = {
        attachInterceptor,
        download,
        scheduleAutoDownload,
        resetRecording,
        addTag,
        updateTagComment,
        deleteTag,
        // Reads — Footer uses these to populate the recording state UI.
        getRecordingLength: () => recording.length,
        getCurrentGameId: () => currentGameId,
        getTags: () => tags.slice(),
        getCurrentFrameIndex: () => Math.max(0, gamestateCount - 1),
        // Latest gamestate's players map — Footer uses it to preview the
        // tag author ("Tagging as <username>") before the tag is saved.
        getCurrentPlayers: () => lastFullGamestate?.players || null,
        // Set of player usernames in this game — drives tag color (player
        // vs reviewer) at render time.
        getPlayerUsernames: () => D().playerUsernamesFromPlayers(lastFullGamestate?.players),
        // Has the recorder seen at least one gamestate this session? The
        // floating launcher uses this to decide whether to render itself
        // (hidden entirely between matches so the extension has zero
        // footprint on karabast.net until capture begins).
        isRecordingActive: () => gamestateCount > 0,
        // karabuddy.com URL of the most recent successful upload for the
        // current recording session. Returns null until uploadReplay resolves
        // with a slug, and is cleared again when a new recording starts.
        getCurrentKarabuddyUrl: () => currentKarabuddyUrl
    };
})();
