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

    // ----- Module state -----
    const recording = [];
    let recordingStart = Date.now();
    let autoDownloadScheduled = false;
    let prevNormalizedGamestate = null;
    let currentGameId = null;

    const resetRecording = () => {
        recording.length = 0;
        recordingStart = Date.now();
        prevNormalizedGamestate = null;
        autoDownloadScheduled = false;
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
                prevNormalizedGamestate
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
        currentGameId = data.gameId;
        NS.dlog(`[karabuddy] resumed recording — ${recording.length} events for game ${incomingGameId}`);
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
            } else {
                const patch = d.makePatch(prevNormalizedGamestate, norm);
                if (Object.keys(patch).length === 0) return;
                recording.push({ t, dir, event: 'gamestate', args: [{ patch }] });
                prevNormalizedGamestate = norm;
            }
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

        // Skip non-games unless the user explicitly asked. Manual still saves
        // so the user can pull a snapshot mid-game even if only one player
        // has acted so far.
        if (!isManual && distinctActivePlayers < 2) {
            console.log(`[karabuddy] skipped save (${reason}) — only ${distinctActivePlayers} distinct active player(s)`);
            clearPersistedRecording();
            resetRecording();
            currentGameId = null;
            F()?.refreshOverlay?.();
            return;
        }

        const payload = {
            version: 2,
            url: location.href,
            startedAt: new Date(recordingStart).toISOString(),
            durationMs,
            reason,
            actionCount,
            gamestateFormat: {
                note: 'gamestate events carry either {full: state} (initial/full snapshot) or {patch: {path: value, ...}} (overwrite leaf at slash-delimited path). Apply in order to reconstruct each frame.',
                strippedTopLevel: [...d.TOP_NOISE],
                strippedPerPlayer: [...d.PLAYER_NOISE]
            },
            events: recording
        };
        const payloadText = JSON.stringify(payload);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = d.buildReplayFilename(ts, meta);

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
        console.log(`[karabuddy] finalized (${reason}) — ${recording.length} events, ${actionCount} actions, ${durationMs}ms`);

        // Always stash in the service-worker IDB so the replays page lists it.
        if (currentGameId) {
            B().saveReplay({
                gameId: currentGameId,
                savedAt: Date.now(),
                startedAt: recordingStart,
                durationMs,
                actionCount,
                filename,
                players: meta,
                payload: payloadText
            }).then(() => F()?.refreshReplayBrowser?.());
        }

        // The game we just persisted is in IDB now; don't restore it on the
        // next page load.
        clearPersistedRecording();

        // Reset in-memory state except for manual partial-downloads, so the
        // sidebar transitions out of recording once the game has actually
        // ended. Manual keeps recording intact so events keep streaming in.
        if (!isManual) {
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

    NS.Recorder = {
        attachInterceptor,
        download,
        scheduleAutoDownload,
        resetRecording,
        // Reads — Footer uses these to populate the recording state UI.
        getRecordingLength: () => recording.length,
        getCurrentGameId: () => currentGameId
    };
})();
