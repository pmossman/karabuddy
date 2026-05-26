// karabuddy.replays.Decoder — pure encode/decode/metadata helpers.
//
// No DOM beyond a one-off CSS install. Used by:
//   - Recorder: normalizeGamestate / makePatch / parseEngineIoFrame /
//     looksLikeGameEnd / extractReplayMeta / buildReplayFilename
//   - Playback / file loader: applyPatch / decodeReplay /
//     stripHiddenHandCards / injectDefaultPromptState /
//     installHiddenCardStyles / extractMetaFromFile
(() => {
    const NS = ((window.__KaraBuddy ||= {}).replays ||= {});

    // Events we capture into a recording. The rest stream past untouched.
    const RECORDED_EVENTS = new Set([
        'gamestate',
        'lobbystate',
        'lobby',
        'message',
        'connectedUser'
    ]);

    // Stripped from stored gamestates: per-second clock fields and player-local
    // UI (prompts, snapshots, etc.) — viewer reconstructs the board, not UX.
    const TOP_NOISE = new Set([
        'clientUIProperties',
        'messageOffset',
        'totalMessages',
        'playerUpdate',
        'undoEnabled'
    ]);
    const PLAYER_NOISE = new Set([
        'turnTimeRemainingSeconds',
        'mainTimeRemainingSeconds',
        'timerIsRunning',
        'promptState',
        'promptedActionWindows',
        'availableSnapshots',
        'disconnected',
        'left'
    ]);

    const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

    const normalizeGamestate = (gs) => {
        if (!isPlainObject(gs)) return gs;
        const out = {};
        for (const k of Object.keys(gs)) {
            if (TOP_NOISE.has(k)) continue;
            out[k] = gs[k];
        }
        if (isPlainObject(out.players)) {
            const np = {};
            for (const pid of Object.keys(out.players)) {
                const p = out.players[pid];
                if (!isPlainObject(p)) { np[pid] = p; continue; }
                const npp = {};
                for (const k of Object.keys(p)) {
                    if (PLAYER_NOISE.has(k)) continue;
                    npp[k] = p[k];
                }
                np[pid] = npp;
            }
            out.players = np;
        }
        return out;
    };

    const makePatch = (oldVal, newVal, path = '') => {
        const patches = {};
        if (!isPlainObject(oldVal) || !isPlainObject(newVal)) {
            if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) patches[path] = newVal;
            return patches;
        }
        const keys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);
        for (const k of keys) {
            const subPath = path ? `${path}/${k}` : k;
            if (!(k in newVal)) continue;
            if (!(k in oldVal)) { patches[subPath] = newVal[k]; continue; }
            if (JSON.stringify(oldVal[k]) === JSON.stringify(newVal[k])) continue;
            if (isPlainObject(oldVal[k]) && isPlainObject(newVal[k])) {
                Object.assign(patches, makePatch(oldVal[k], newVal[k], subPath));
            } else {
                patches[subPath] = newVal[k];
            }
        }
        return patches;
    };

    const applyPatch = (state, patch) => {
        for (const [path, value] of Object.entries(patch)) {
            const parts = path.split('/');
            let obj = state;
            for (let i = 0; i < parts.length - 1; i++) {
                const k = parts[i];
                if (!isPlainObject(obj[k])) obj[k] = {};
                obj = obj[k];
            }
            obj[parts[parts.length - 1]] = value;
        }
    };

    const parseEngineIoFrame = (data) => {
        if (typeof data !== 'string' || data.length === 0) return null;
        if (data[0] !== '4') return null;
        let rest = data.slice(1);
        if (rest.length === 0) return null;
        const sioType = rest[0];
        rest = rest.slice(1);
        if (sioType !== '2' && sioType !== '3') return null;

        let ackId = null;
        const ackMatch = rest.match(/^(\d+)/);
        if (ackMatch) {
            ackId = parseInt(ackMatch[1], 10);
            rest = rest.slice(ackMatch[1].length);
        }
        try {
            const parsed = JSON.parse(rest);
            if (sioType === '2') {
                if (!Array.isArray(parsed) || parsed.length === 0) return null;
                return { kind: 'event', event: parsed[0], args: parsed.slice(1), ackId };
            }
            return { kind: 'ack', args: Array.isArray(parsed) ? parsed : [parsed], ackId };
        } catch {
            return null;
        }
    };

    const looksLikeGameEnd = (state) => {
        if (!state || typeof state !== 'object') return false;
        return Boolean(
            (Array.isArray(state.winners) && state.winners.length > 0) ||
                state.winner ||
                state.endGameInfo ||
                state.endResult ||
                state.gameOver ||
                state.phase === 'endgame'
        );
    };

    // ----- Metadata extraction (live + file) -----

    const sanitizeFilenamePart = (s) =>
        (s || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);

    // YYMMDD-HHMM in local time, compact and naturally sortable per-year.
    const formatFilenameTimestamp = (ms) => {
        const d = new Date(ms);
        const pad = (n) => String(n).padStart(2, '0');
        return `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    };

    const isAnonymousUsername = (u) => !u || /^anonymous\s/i.test(u);

    const extractPlayerSummaries = (players) => {
        if (!players || typeof players !== 'object') return [];
        return Object.values(players).map((p) => ({
            username: p.user?.username || '',
            leader: p.leader ? {
                name: p.leader.name || '',
                set: p.leader.setId?.set || '',
                number: p.leader.setId?.number || 0
            } : null,
            base: p.base ? {
                name: p.base.name || '',
                set: p.base.setId?.set || '',
                number: p.base.setId?.number || 0
            } : null
        }));
    };

    // Live extractor: walks the in-memory recording array (recorder owns it).
    const extractReplayMeta = (recording) => {
        const firstFull = recording.find(
            (e) => e.event === 'gamestate' && e.args[0] && e.args[0].full
        );
        return extractPlayerSummaries(firstFull?.args[0]?.full?.players);
    };

    // File extractor: walks the parsed payload (v1 raw, v2 {full}/{patch}).
    const extractMetaFromFile = (parsed) => {
        const events = Array.isArray(parsed.events) ? parsed.events : [];
        const firstGamestate = events.find((e) => e.event === 'gamestate' && e.args?.[0]);
        if (!firstGamestate) return { gameId: null, players: [] };
        const arg = firstGamestate.args[0];
        const snapshot = arg.full || (parsed.version === 1 ? arg : null);
        if (!snapshot) return { gameId: null, players: [] };
        return {
            gameId: snapshot.id || null,
            players: extractPlayerSummaries(snapshot.players)
        };
    };

    const buildReplayFilename = (whenMs, meta) => {
        const ts = formatFilenameTimestamp(whenMs);
        if (!meta || meta.length < 2) return `${ts}.karareplay`;
        const parts = meta.map((p) => {
            const user = isAnonymousUsername(p.username)
                ? 'anon'
                : sanitizeFilenamePart(p.username);
            const leader = sanitizeFilenamePart(p.leader?.name);
            const base = sanitizeFilenamePart(p.base?.name);
            const deck = [leader, base].filter(Boolean).join('-');
            return [deck, user].filter(Boolean).join('_') || 'unknown';
        });
        return `${ts}_${parts.join('_vs_')}.karareplay`;
    };

    // ----- Frame transforms for playback rendering -----

    // Player-perspective recordings include opponent hand cards as stubs without
    // id/setId. Karabast's renderer shows them as broken "UNKNOWN_EN IMAGE NOT
    // FOUND" placeholders. Replace each stub with a card carrying a sentinel
    // setId so a data-card-id="REPLAYHIDDEN_0" lands in the DOM; our injected
    // CSS then paints those as flat gray rectangles.
    const HIDDEN_SET = 'REPLAYHIDDEN';
    const HIDDEN_DATA_CARD_ID = `${HIDDEN_SET}_0`;
    const stripHiddenHandCards = (state) => {
        if (!state?.players || typeof state.players !== 'object') return state;
        for (const pid of Object.keys(state.players)) {
            const player = state.players[pid];
            const piles = player?.cardPiles;
            if (!piles || !Array.isArray(piles.hand)) continue;
            piles.hand = piles.hand.map((c, i) => {
                if (c && (c.id || c.setId)) return c;
                return {
                    controllerId: c?.controllerId,
                    ownerId: c?.ownerId,
                    zone: 'hand',
                    uuid: `replay-hidden-${pid}-${i}`,
                    selectable: false,
                    id: HIDDEN_DATA_CARD_ID,
                    setId: { set: HIDDEN_SET, number: 0 },
                    name: '',
                    type: 'basicUnit',
                    printedType: 'basicUnit',
                    aspects: [],
                    isBlanked: false
                };
            });
        }
        return state;
    };

    // Karabast's React reads `players[X].promptState.promptTitle` (and friends)
    // unconditionally; we strip promptState during recording to save bytes, so
    // inject a well-formed empty default to keep the renderer happy. Spectator
    // playback never wants a prompt, so empty is the right value.
    const EMPTY_PROMPT_STATE = Object.freeze({
        selectCardMode: false,
        selectOrder: false,
        distributeAmongTargets: null,
        dropdownListOptions: [],
        menuTitle: '',
        promptTitle: '',
        buttons: [],
        promptUuid: null,
        promptType: '',
        displayCards: [],
        perCardButtons: [],
        isOpponentEffect: false,
        playerIsNewlyActive: false
    });
    const injectDefaultPromptState = (state) => {
        if (!state?.players || typeof state.players !== 'object') return state;
        for (const pid of Object.keys(state.players)) {
            const p = state.players[pid];
            if (!p) continue;
            if (!p.promptState) p.promptState = { ...EMPTY_PROMPT_STATE };
        }
        return state;
    };

    const installHiddenCardStyles = () => {
        if (document.getElementById('karabast-replays-hidden-styles')) return;
        const style = document.createElement('style');
        style.id = 'karabast-replays-hidden-styles';
        style.textContent = `
            [data-card-id="${HIDDEN_DATA_CARD_ID}"] {
                background: #3a3e46 !important;
                background-image: none !important;
                border-radius: 6px !important;
                border: 1px solid #4a4e56 !important;
            }
            [data-card-id="${HIDDEN_DATA_CARD_ID}"] * {
                visibility: hidden !important;
            }
            *:has(> [data-card-id="${HIDDEN_DATA_CARD_ID}"]) > *:not([data-card-id="${HIDDEN_DATA_CARD_ID}"]) {
                visibility: hidden !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    };

    // ----- Top-level decoder: bytes → renderable frames -----

    const decodeReplay = (file) => {
        if (!file || typeof file !== 'object') throw new Error('Invalid replay file');
        if (file.version !== 1 && file.version !== 2) {
            throw new Error(`Unsupported replay version: ${file.version}`);
        }
        const events = Array.isArray(file.events) ? file.events : [];
        const frames = [];
        const sideEvents = [];
        let current = null;
        for (const e of events) {
            if (e.event === 'gamestate') {
                const arg = e.args?.[0];
                if (!arg) continue;
                if (file.version === 1) {
                    current = structuredClone(arg);
                } else if (arg.full) {
                    current = structuredClone(arg.full);
                } else if (arg.patch) {
                    if (!current) throw new Error('Patch event before any full snapshot');
                    applyPatch(current, arg.patch);
                } else {
                    continue;
                }
                const snapshot = structuredClone(current);
                stripHiddenHandCards(snapshot);
                injectDefaultPromptState(snapshot);
                frames.push({ t: e.t, state: snapshot });
            } else {
                sideEvents.push({
                    t: e.t,
                    dir: e.dir,
                    event: e.event,
                    args: e.args,
                    frameIndex: frames.length - 1
                });
            }
        }
        const activeByFrame = frames.map((f) => {
            const players = f.state?.players;
            if (!players) return null;
            for (const pid of Object.keys(players)) {
                if (players[pid]?.isActionPhaseActivePlayer) return pid;
            }
            return null;
        });
        const messagesByFrame = frames.map((f) =>
            Array.isArray(f.state?.newMessages) ? f.state.newMessages : []
        );
        return {
            frames,
            sideEvents,
            activeByFrame,
            messagesByFrame,
            meta: {
                url: file.url,
                startedAt: file.startedAt,
                durationMs: file.durationMs,
                reason: file.reason,
                version: file.version
            }
        };
    };

    // ----- Tag identity, author, color -----
    //
    // Tags are user-curated annotations anchored to a frame in the replay.
    // They live inside the replay payload (additive JSON field) and survive
    // round-tripping through the file. Each tag knows its author so multiple
    // reviewers' marks remain distinguishable when a replay is passed around.

    const TAG_AUTHOR_KEY = 'karabuddyTagAuthor';

    const makeTagId = () => {
        if (crypto?.randomUUID) return crypto.randomUUID();
        return 'tag-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
    };

    // Try the in-game username first; fall back to a persisted anon-XXXX
    // handle. The anon handle is generated once per browser profile and
    // reused so the same person's tags are color-stable across replays.
    const getOrCreateAuthor = (livePlayers) => {
        // Path 1: live recording or playback — sniff the gamestate for a
        // real karabast username.
        if (livePlayers && typeof livePlayers === 'object') {
            for (const p of Object.values(livePlayers)) {
                const u = p?.user?.username;
                if (u && !isAnonymousUsername(u)) return u;
            }
        }
        // Path 2: persisted anon handle.
        try {
            const stored = localStorage.getItem(TAG_AUTHOR_KEY);
            if (stored) return stored;
            const fresh = 'anon-' + Math.random().toString(36).slice(2, 6);
            localStorage.setItem(TAG_AUTHOR_KEY, fresh);
            return fresh;
        } catch {
            return 'anon-' + Math.random().toString(36).slice(2, 6);
        }
    };

    // Two-color scheme for tag attribution at render time. We don't store
    // the color on the tag — it's derived from whether the author was one
    // of the game's actual players (read off the snapshot in the payload)
    // or a 3rd-party reviewer. Letting the reader's view decide keeps the
    // scheme stable when replays are shared between people.
    const TAG_COLOR_PLAYER = '#6bd968';   // green — was at the table
    const TAG_COLOR_REVIEWER = '#e0c64a'; // yellow — added after the fact

    const playerColorFor = (author, playerUsernames) => {
        if (!playerUsernames) return TAG_COLOR_REVIEWER;
        const set = playerUsernames instanceof Set
            ? playerUsernames
            : new Set(Array.isArray(playerUsernames) ? playerUsernames : Object.values(playerUsernames || {}));
        return set.has(author) ? TAG_COLOR_PLAYER : TAG_COLOR_REVIEWER;
    };

    // Build a Set of usernames participating in a game from a snapshot's
    // players map. Drops blank/anonymous entries so the comparison doesn't
    // mark a 3rd-party "anonymous" as a player.
    const playerUsernamesFromPlayers = (players) => {
        const out = new Set();
        if (!players || typeof players !== 'object') return out;
        for (const p of Object.values(players)) {
            const u = p?.user?.username;
            if (u && !isAnonymousUsername(u)) out.add(u);
        }
        return out;
    };

    NS.Decoder = {
        RECORDED_EVENTS,
        TOP_NOISE,
        PLAYER_NOISE,
        normalizeGamestate,
        makePatch,
        applyPatch,
        parseEngineIoFrame,
        looksLikeGameEnd,
        sanitizeFilenamePart,
        isAnonymousUsername,
        extractReplayMeta,
        extractMetaFromFile,
        buildReplayFilename,
        stripHiddenHandCards,
        injectDefaultPromptState,
        installHiddenCardStyles,
        decodeReplay,
        EMPTY_PROMPT_STATE,
        makeTagId,
        getOrCreateAuthor,
        playerColorFor,
        playerUsernamesFromPlayers,
        TAG_COLOR_PLAYER,
        TAG_COLOR_REVIEWER
    };
})();
