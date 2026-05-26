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
    a.download = filename || 'karabuddy-replay.karareplay';
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

const sideText = (p) => {
    const lname = p.leader?.name || 'Unknown';
    const uname = p.username && !isAnonymousUsername(p.username) ? p.username : '';
    return uname ? `${uname} (${lname})` : lname;
};

const buildSideEl = (p) => {
    const wrap = document.createElement('div');
    wrap.className = 'side';
    const mkImg = (url, alt) => {
        const img = document.createElement('img');
        img.alt = alt || '';
        img.loading = 'lazy';
        if (url) img.src = url;
        img.onerror = () => { img.style.visibility = 'hidden'; };
        return img;
    };
    wrap.appendChild(mkImg(cardImageUrl(p.leader, true), p.leader?.name));
    wrap.appendChild(mkImg(cardImageUrl(p.base, false), p.base?.name));
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

    const matchupText = document.createElement('div');
    matchupText.className = 'matchup-text';
    matchupText.textContent =
        `${sideText(entry.players[0] || {})}  vs  ${sideText(entry.players[1] || {})}`;

    const meta = document.createElement('div');
    meta.className = 'meta-row';
    const when = document.createElement('span');
    when.textContent = `${formatReplayDate(entry.savedAt)} · ${formatActionCount(entry.actionCount)} · ${formatDuration(entry.durationMs)}`;

    const actions = document.createElement('div');
    actions.className = 'meta-actions';
    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'meta-btn';
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
    del.className = 'meta-btn delete';
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
    card.appendChild(matchupText);
    card.appendChild(meta);
    return card;
};

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

document.getElementById('home-link').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://karabast.net/' });
});

refresh();
