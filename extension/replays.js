const send = (msg) =>
    new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));

const cardImageUrl = (card, isLeader) => {
    if (!card || !card.set || !card.number) return null;
    const suffix = isLeader ? '-base' : '';
    return `https://karabast-data.s3.amazonaws.com/cards/${card.set.toUpperCase()}/standard/large/${String(card.number).padStart(3, '0')}${suffix}.webp?v=2`;
};

const isAnonymousUsername = (u) => !u || /^anonymous\s/i.test(u);

const formatReplayDate = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return `Today, ${time}`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
    return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' }) + `, ${time}`;
};

const formatDuration = (ms) => {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
};

const formatActionCount = (n) => {
    if (n == null) return '? actions';
    if (n === 1) return '1 action';
    return `${n} actions`;
};

const triggerFileDownload = (filename, payloadText) => {
    const blob = new Blob([payloadText], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'replay.karareplay';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

const replayMatchesFilter = (entry, filter) => {
    if (!filter) return true;
    const haystack = [
        formatReplayDate(entry.savedAt),
        new Date(entry.savedAt).toLocaleDateString(),
        ...entry.players.flatMap((p) => [p.username, p.leader?.name, p.base?.name])
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(filter.toLowerCase().trim());
};

const deckText = (p) => {
    const lname = p.leader?.name || 'Unknown leader';
    const lset = p.leader?.set ? ` (${p.leader.set})` : '';
    const bname = p.base?.name || 'Unknown base';
    return `${lname}${lset} / ${bname}`;
};

const usernameText = (p) => {
    if (!p.username || isAnonymousUsername(p.username)) return 'anonymous';
    return p.username;
};

const buildPlaceholder = (label) => {
    const el = document.createElement('div');
    el.className = 'placeholder';
    el.textContent = label || '—';
    return el;
};

const buildSlot = (url, alt) => {
    if (!url) return buildPlaceholder(alt);
    const img = document.createElement('img');
    img.alt = alt || '';
    img.loading = 'lazy';
    img.src = url;
    img.onerror = () => img.replaceWith(buildPlaceholder(alt));
    return img;
};

const buildSideEl = (p) => {
    const wrap = document.createElement('div');
    wrap.className = 'side';
    wrap.appendChild(buildSlot(cardImageUrl(p.leader, true), p.leader?.name));
    wrap.appendChild(buildSlot(cardImageUrl(p.base, false), p.base?.name));
    return wrap;
};

const buildCard = (entry) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.title = 'Click to play this replay';
    card.addEventListener('click', async () => {
        const res = await send({ type: 'playReplay', gameId: entry.gameId });
        if (!res?.ok) alert(`Failed to play replay: ${res?.error || 'unknown'}`);
    });

    const matchup = document.createElement('div');
    matchup.className = 'matchup';
    const versus = document.createElement('span');
    versus.className = 'versus';
    versus.textContent = 'VS';
    matchup.appendChild(buildSideEl(entry.players[0] || {}));
    matchup.appendChild(versus);
    matchup.appendChild(buildSideEl(entry.players[1] || {}));

    const p0 = entry.players[0] || {};
    const p1 = entry.players[1] || {};

    const deckLine = document.createElement('div');
    deckLine.className = 'deck-line';
    deckLine.textContent = `${deckText(p0)}  vs  ${deckText(p1)}`;

    const usernameLine = document.createElement('div');
    usernameLine.className = 'username-line';
    usernameLine.textContent = `${usernameText(p0)} vs ${usernameText(p1)}`;

    const meta = document.createElement('div');
    meta.className = 'meta-row';
    const when = document.createElement('span');
    when.textContent = `${formatReplayDate(entry.savedAt)} · ${formatActionCount(entry.actionCount)} · ${formatDuration(entry.durationMs)}`;

    const actions = document.createElement('div');
    actions.className = 'meta-actions';
    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'kb-btn kb-btn--ghost';
    dl.title = 'Download this replay as a .karareplay file';
    dl.textContent = '⬇';
    dl.addEventListener('click', async (e) => {
        e.stopPropagation();
        const full = await send({ type: 'getReplay', gameId: entry.gameId });
        const payload = full?.data?.payload;
        if (!payload) {
            alert('Could not load replay payload for download.');
            return;
        }
        triggerFileDownload(full.data.filename, payload);
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'kb-btn kb-btn--ghost delete';
    del.title = 'Delete this saved replay';
    del.textContent = '✕';
    del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this saved replay?')) return;
        await send({ type: 'deleteReplay', gameId: entry.gameId });
        await refresh();
    });
    actions.appendChild(dl);
    actions.appendChild(del);

    meta.appendChild(when);
    meta.appendChild(actions);

    card.appendChild(matchup);
    card.appendChild(deckLine);
    card.appendChild(usernameLine);
    card.appendChild(meta);
    return card;
};

// ---------- File upload ----------
// Replays.html runs in chrome-extension://, away from the karabast.net
// Decoder module. Inline the minimum parsing needed to extract gameId +
// player metadata so we can save into the same IDB the recorder writes to.
const extractMetaFromUploadedFile = (parsed) => {
    if (!parsed || typeof parsed !== 'object') return { gameId: null, players: [] };
    if (parsed.version !== 1 && parsed.version !== 2) {
        throw new Error(`Unsupported replay version: ${parsed.version}`);
    }
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    const firstGamestate = events.find((e) => e.event === 'gamestate' && e.args?.[0]);
    if (!firstGamestate) return { gameId: null, players: [] };
    const arg = firstGamestate.args[0];
    const snapshot = arg.full || (parsed.version === 1 ? arg : null);
    if (!snapshot) return { gameId: null, players: [] };
    const players = snapshot.players
        ? Object.values(snapshot.players).map((p) => ({
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
          }))
        : [];
    return { gameId: snapshot.id || null, players };
};

const uploadStatusEl = document.getElementById('upload-status');
const setUploadStatus = (text, kind = '') => {
    if (!text) {
        uploadStatusEl.hidden = true;
        uploadStatusEl.textContent = '';
        return;
    }
    uploadStatusEl.hidden = false;
    uploadStatusEl.textContent = text;
    const variant = kind ? ` kb-banner--${kind}` : '';
    uploadStatusEl.className = `upload-status kb-banner${variant}`;
};

const handleUpload = (file) => {
    setUploadStatus(`Reading ${file.name}…`);
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const parsed = JSON.parse(reader.result);
            const { gameId, players } = extractMetaFromUploadedFile(parsed);
            if (!gameId) throw new Error('No gameId found in replay (missing initial snapshot?)');
            const entry = {
                gameId,
                savedAt: Date.now(),
                startedAt: parsed.startedAt ? (Date.parse(parsed.startedAt) || Date.now()) : Date.now(),
                durationMs: parsed.durationMs || 0,
                actionCount: parsed.actionCount,
                filename: file.name,
                players,
                payload: reader.result
            };
            const res = await send({ type: 'saveReplay', entry });
            if (!res?.ok) throw new Error(res?.error || 'background save failed');
            setUploadStatus(`Uploaded "${file.name}".`, 'success');
            await refresh();
        } catch (err) {
            console.error('[karabuddy] upload failed:', err);
            setUploadStatus(`Upload failed: ${err.message}`, 'error');
        }
    };
    reader.onerror = () => setUploadStatus('Failed to read file.', 'error');
    reader.readAsText(file);
};

const uploadInputEl = document.getElementById('upload-input');
document.getElementById('upload').addEventListener('click', () => uploadInputEl.click());
uploadInputEl.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) handleUpload(f);
    e.target.value = '';
});

let cache = [];

const refresh = async () => {
    const res = await send({ type: 'listReplays' });
    cache = res?.data || [];
    render();
};

const render = () => {
    const filter = document.getElementById('filter').value;
    const filtered = cache.filter((e) => replayMatchesFilter(e, filter));
    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');
    const emptyFilter = document.getElementById('empty-filter');
    const loading = document.getElementById('loading');
    const count = document.getElementById('count');

    loading.hidden = true;
    count.textContent = filter
        ? `${filtered.length} of ${cache.length} replay${cache.length === 1 ? '' : 's'}`
        : `${cache.length} replay${cache.length === 1 ? '' : 's'}`;

    if (cache.length === 0) {
        grid.hidden = true;
        emptyFilter.hidden = true;
        empty.hidden = false;
        return;
    }
    if (filtered.length === 0) {
        grid.hidden = true;
        empty.hidden = true;
        emptyFilter.hidden = false;
        return;
    }
    empty.hidden = true;
    emptyFilter.hidden = true;
    grid.hidden = false;
    grid.innerHTML = '';
    for (const entry of filtered) grid.appendChild(buildCard(entry));
};

document.getElementById('filter').addEventListener('input', render);

refresh();
