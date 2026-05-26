const listEl = document.getElementById('deck-list');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const statusEl = document.getElementById('status');
const importBtn = document.getElementById('import');
const addForm = document.getElementById('add-form');

const send = (msg) =>
    new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));

const cardImageUrl = (cardId, isLeader) => {
    if (!cardId) return null;
    const match = cardId.match(/^([A-Z0-9]+)_(\d+)$/i);
    if (!match) return null;
    const [, set, num] = match;
    const suffix = isLeader ? '-base' : '';
    return `https://karabast-data.s3.amazonaws.com/cards/${set.toUpperCase()}/standard/large/${num.padStart(3, '0')}${suffix}.webp?v=2`;
};

const extractSet = (cardId) => {
    if (!cardId) return null;
    const m = cardId.match(/^([A-Z0-9]+)_/i);
    return m ? m[1].toUpperCase() : null;
};

// Render a row of toggleable set-code chips above a deck list. `getSet` plucks
// the set code from each item, `selection` is the Set of active chips, and
// `onChange` fires after the user toggles or clears.
const renderSetFilter = (containerEl, items, getSet, selection, onChange) => {
    containerEl.innerHTML = '';
    const sets = Array.from(new Set(items.map(getSet).filter(Boolean))).sort();
    if (sets.length < 2) return; // nothing useful to filter when there's only one set
    const label = document.createElement('span');
    label.className = 'set-filter-label';
    label.textContent = 'Leader set:';
    containerEl.appendChild(label);
    for (const code of sets) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'set-chip' + (selection.has(code) ? ' active' : '');
        chip.textContent = code;
        chip.addEventListener('click', () => {
            if (selection.has(code)) selection.delete(code);
            else selection.add(code);
            onChange();
        });
        containerEl.appendChild(chip);
    }
    if (selection.size > 0) {
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'set-chip-clear';
        clear.textContent = 'clear';
        clear.addEventListener('click', () => {
            selection.clear();
            onChange();
        });
        containerEl.appendChild(clear);
    }
};

const passesSetFilter = (item, getSet, selection) => {
    if (selection.size === 0) return true;
    const s = getSet(item);
    return s ? selection.has(s) : false;
};

const makeThumb = (cardId, isLeader, label) => {
    const img = document.createElement('img');
    img.className = isLeader ? 'leader-img' : 'base-img';
    img.alt = label;
    const url = cardImageUrl(cardId, isLeader);
    if (url) {
        img.src = url;
        img.onerror = () => {
            img.style.visibility = 'hidden';
        };
    } else {
        img.style.visibility = 'hidden';
    }
    return img;
};

const setStatus = (text, kind = '') => {
    statusEl.textContent = text;
    statusEl.className = `status ${kind}`.trim();
};

// Selection state for bulk delete.
const selectedDeckIds = new Set();
const deckToolbarEl = document.getElementById('deck-toolbar');
const deckSelectAllEl = document.getElementById('deck-select-all');
const deckSelectionCountEl = document.getElementById('deck-selection-count');
const deckDeleteSelectedBtn = document.getElementById('deck-delete-selected');

const visibleDeckIds = () => Array.from(listEl.querySelectorAll('li[data-deck-id]'))
    .map((li) => li.dataset.deckId);

const syncSelectionUI = () => {
    const visible = visibleDeckIds();
    const checkedVisible = visible.filter((id) => selectedDeckIds.has(id));
    deckSelectAllEl.checked = visible.length > 0 && checkedVisible.length === visible.length;
    deckSelectAllEl.indeterminate = checkedVisible.length > 0 && checkedVisible.length < visible.length;
    const n = selectedDeckIds.size;
    deckSelectionCountEl.textContent = n === 0 ? '' : `${n} selected`;
    deckDeleteSelectedBtn.disabled = n === 0;
    deckDeleteSelectedBtn.textContent = n === 0 ? 'Delete selected' : `Delete selected (${n})`;
    for (const li of listEl.querySelectorAll('li[data-deck-id]')) {
        li.classList.toggle('selected', selectedDeckIds.has(li.dataset.deckId));
    }
};

deckSelectAllEl.addEventListener('change', () => {
    const visible = visibleDeckIds();
    if (deckSelectAllEl.checked) {
        for (const id of visible) selectedDeckIds.add(id);
    } else {
        for (const id of visible) selectedDeckIds.delete(id);
    }
    // reflect on each row's checkbox
    for (const cb of listEl.querySelectorAll('.row-check')) {
        cb.checked = selectedDeckIds.has(cb.dataset.deckId);
    }
    syncSelectionUI();
});

deckDeleteSelectedBtn.addEventListener('click', async () => {
    const ids = Array.from(selectedDeckIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected deck${ids.length === 1 ? '' : 's'}?`)) return;
    deckDeleteSelectedBtn.disabled = true;
    const res = await send({ type: 'removeDecks', deckIds: ids });
    if (!res.ok) {
        setStatus(res.error, 'error');
        deckDeleteSelectedBtn.disabled = false;
        return;
    }
    selectedDeckIds.clear();
    setStatus(`Removed ${res.removed} deck${res.removed === 1 ? '' : 's'}.`);
    refresh();
});

const selectedDeckSets = new Set();
const deckSetFilterEl = document.getElementById('deck-set-filter');
let cachedFullDecks = [];

const renderDecks = (decks) => {
    cachedFullDecks = decks;
    renderSetFilter(deckSetFilterEl, decks, (d) => extractSet(d.leaderId), selectedDeckSets, () => renderDecks(cachedFullDecks));
    const visibleDecks = decks.filter((d) => passesSetFilter(d, (x) => extractSet(x.leaderId), selectedDeckSets));

    listEl.innerHTML = '';
    emptyEl.hidden = decks.length > 0;
    countEl.textContent = selectedDeckSets.size > 0
        ? `${visibleDecks.length} of ${decks.length} deck${decks.length === 1 ? '' : 's'}`
        : (decks.length === 1 ? '1 deck' : `${decks.length} decks`);
    deckToolbarEl.hidden = decks.length === 0;
    // Drop any selected IDs that no longer exist in the list.
    const knownIds = new Set(decks.map((d) => d.id));
    for (const id of Array.from(selectedDeckIds)) {
        if (!knownIds.has(id)) selectedDeckIds.delete(id);
    }

    for (const deck of visibleDecks) {
        const li = document.createElement('li');
        li.dataset.deckId = deck.id;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'row-check';
        cb.dataset.deckId = deck.id;
        cb.checked = selectedDeckIds.has(deck.id);
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', () => {
            if (cb.checked) selectedDeckIds.add(deck.id);
            else selectedDeckIds.delete(deck.id);
            syncSelectionUI();
        });
        li.appendChild(cb);

        li.appendChild(makeThumb(deck.leaderId, true, 'leader'));
        li.appendChild(makeThumb(deck.baseId, false, 'base'));

        const info = document.createElement('div');
        info.className = 'info';
        const name = document.createElement('strong');
        name.textContent = deck.name;
        info.appendChild(name);
        if (deck.leaderId || deck.baseId) {
            const meta = document.createElement('div');
            meta.className = 'meta';
            meta.textContent = [deck.leaderId, deck.baseId].filter(Boolean).join(' / ');
            info.appendChild(meta);
        }
        const link = document.createElement('a');
        link.href = deck.deckLink;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = 'view';
        info.appendChild(link);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'danger';
        removeBtn.textContent = 'Delete';
        removeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const res = await send({ type: 'removeDeck', deckId: deck.id });
            if (res.ok) {
                selectedDeckIds.delete(deck.id);
                refresh();
                setStatus(`Removed “${deck.name}”.`);
            } else {
                setStatus(res.error, 'error');
            }
        });

        li.appendChild(info);
        li.appendChild(removeBtn);

        // Clicking elsewhere on the row toggles the checkbox.
        li.addEventListener('click', () => {
            cb.checked = !cb.checked;
            if (cb.checked) selectedDeckIds.add(deck.id);
            else selectedDeckIds.delete(deck.id);
            syncSelectionUI();
        });

        listEl.appendChild(li);
    }

    syncSelectionUI();
};

// ---------- Match setup (per-side decks + match settings) ----------
const setupForm = document.getElementById('setup-form');
let cachedDecks = [];

const setImage = (img, src) => {
    if (!src) {
        img.removeAttribute('src');
        img.style.visibility = 'hidden';
        return;
    }
    img.style.visibility = 'visible';
    img.src = src;
    img.onerror = () => { img.style.visibility = 'hidden'; };
};

const getDeckValue = (side) =>
    document.querySelector(`.custom-select[data-side="${side}"]`).dataset.value || 'custom';

const setDeckValue = (side, value) => {
    const cs = document.querySelector(`.custom-select[data-side="${side}"]`);
    cs.dataset.value = value;
    updateTrigger(side);
};

const updateTrigger = (side) => {
    const cs = document.querySelector(`.custom-select[data-side="${side}"]`);
    const value = cs.dataset.value || 'custom';
    const trigger = cs.querySelector('.cs-trigger');
    const leaderImg = trigger.querySelector('.cs-leader');
    const baseImg = trigger.querySelector('.cs-base');
    const text = trigger.querySelector('.cs-text');
    const deck = cachedDecks.find((d) => d.id === value);
    if (deck) {
        setImage(leaderImg, cardImageUrl(deck.leaderId, true));
        setImage(baseImg, cardImageUrl(deck.baseId, false));
        text.textContent = deck.name;
    } else {
        leaderImg.style.visibility = 'hidden';
        baseImg.style.visibility = 'hidden';
        text.textContent = value === 'custom' ? 'Custom URL' : 'Choose a deck';
    }
};

const closeAllDropdowns = (except) => {
    for (const cs of document.querySelectorAll('.custom-select')) {
        if (cs === except) continue;
        cs.classList.remove('open');
        cs.querySelector('.cs-options').hidden = true;
    }
};

const renderOptions = (side) => {
    const cs = document.querySelector(`.custom-select[data-side="${side}"]`);
    const optionsEl = cs.querySelector('.cs-options');
    optionsEl.innerHTML = '';
    const appendOption = (value, content) => {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'cs-option';
        opt.dataset.value = value;
        content(opt);
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            setDeckValue(side, value);
            closeAllDropdowns();
            refreshCustomVisibility();
            persistSetup();
        });
        optionsEl.appendChild(opt);
    };
    for (const deck of cachedDecks) {
        appendOption(deck.id, (opt) => {
            const leader = document.createElement('img');
            setImage(leader, cardImageUrl(deck.leaderId, true));
            const base = document.createElement('img');
            setImage(base, cardImageUrl(deck.baseId, false));
            const text = document.createElement('span');
            text.className = 'cs-option-text';
            text.textContent = deck.name;
            opt.appendChild(leader);
            opt.appendChild(base);
            opt.appendChild(text);
        });
    }
    if (cachedDecks.length > 0) {
        const divider = document.createElement('hr');
        divider.className = 'cs-divider';
        optionsEl.appendChild(divider);
    }
    appendOption('custom', (opt) => {
        const text = document.createElement('span');
        text.className = 'cs-option-text';
        text.textContent = '— Custom URL —';
        opt.appendChild(text);
    });
};

const bindDropdownTrigger = (side) => {
    const cs = document.querySelector(`.custom-select[data-side="${side}"]`);
    const trigger = cs.querySelector('.cs-trigger');
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const optionsEl = cs.querySelector('.cs-options');
        const wasOpen = !optionsEl.hidden;
        closeAllDropdowns();
        if (!wasOpen) {
            optionsEl.hidden = false;
            cs.classList.add('open');
        }
    });
};

document.addEventListener('click', () => closeAllDropdowns());

const refreshCustomVisibility = () => {
    for (const side of ['A', 'B']) {
        const wrap = document.querySelector(`.custom-link[data-side="${side}"]`);
        wrap.hidden = getDeckValue(side) !== 'custom';
    }
};

let setupBound = false;
const hydrateSetup = (config) => {
    cachedDecks = config.decks;
    for (const side of ['A', 'B']) {
        const stored = config.sides[side].selectedDeckId;
        const isValid = stored === 'custom' || cachedDecks.some((d) => d.id === stored);
        setDeckValue(side, isValid ? stored : 'custom');
        renderOptions(side);
        if (!setupBound) bindDropdownTrigger(side);
    }
    setupForm.elements.A_customDeckLink.value = config.sides.A.customDeckLink || '';
    setupForm.elements.B_customDeckLink.value = config.sides.B.customDeckLink || '';
    setupForm.elements.format.value = config.match.format;
    setupForm.elements.cardPool.value = config.match.cardPool;
    setupForm.elements.gamesToWinMode.value = config.match.gamesToWinMode;
    refreshCustomVisibility();
    setupBound = true;
};

const persistSetup = async () => {
    const { ok, config } = await send({ type: 'getConfig' });
    if (!ok) return;
    const sides = {
        A: {
            ...config.sides.A,
            selectedDeckId: getDeckValue('A'),
            customDeckLink: setupForm.elements.A_customDeckLink.value.trim()
        },
        B: {
            ...config.sides.B,
            selectedDeckId: getDeckValue('B'),
            customDeckLink: setupForm.elements.B_customDeckLink.value.trim()
        }
    };
    const match = {
        format: setupForm.elements.format.value,
        cardPool: setupForm.elements.cardPool.value,
        gamesToWinMode: setupForm.elements.gamesToWinMode.value
    };
    await send({ type: 'saveSides', sides });
    await send({ type: 'saveMatch', match });
};

setupForm.addEventListener('input', persistSetup);
setupForm.addEventListener('change', persistSetup);

// ---------- Launch / stop controls ----------
const launchBtn = document.getElementById('launch');
const stopBtn = document.getElementById('stop');
const launchStatusEl = document.getElementById('launch-status');

const setLaunchStatus = (text, kind = '') => {
    launchStatusEl.textContent = text;
    launchStatusEl.className = `status ${kind}`.trim();
};

const renderSessionState = (session) => {
    if (session) {
        launchBtn.hidden = true;
        stopBtn.hidden = false;
        setLaunchStatus(
            session.lobbyId
                ? `Session active · lobby ${session.lobbyId.slice(0, 8)}…`
                : 'Session active · creating lobby…',
            'success'
        );
    } else {
        launchBtn.hidden = false;
        stopBtn.hidden = true;
    }
};

launchBtn.addEventListener('click', async () => {
    await persistSetup();
    setLaunchStatus('Starting session…');
    launchBtn.disabled = true;
    const res = await send({ type: 'startSession' });
    launchBtn.disabled = false;
    if (!res.ok) {
        setLaunchStatus(res.error, 'error');
        return;
    }
    setLaunchStatus('Session started — windows are opening.', 'success');
    refresh();
});

stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    const res = await send({ type: 'stopSession' });
    stopBtn.disabled = false;
    if (!res.ok) {
        setLaunchStatus(res.error, 'error');
        return;
    }
    setLaunchStatus('Session stopped.');
    refresh();
});

const refresh = async () => {
    const { ok, config, error } = await send({ type: 'getConfig' });
    if (!ok) {
        setStatus(error || 'Failed to load.', 'error');
        return;
    }
    renderDecks(config.decks);
    hydrateSetup(config);
    renderSessionState(config.session);
};

document.getElementById('home-link').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://karabast.net/' });
});

// ---------- Karabast import picker ----------
const importStatusEl = document.getElementById('import-status');
const importResultsEl = document.getElementById('import-results');
const importListEl = document.getElementById('import-list');
const importAddBtn = document.getElementById('import-add');
const importSelectAllEl = document.getElementById('import-select-all');

const setImportStatus = (text, kind = '') => {
    importStatusEl.textContent = text;
    importStatusEl.className = `muted ${kind}`.trim();
};

let fetchedRemoteDecks = [];

const updateAddButtonState = () => {
    const checked = importListEl.querySelectorAll('input[type="checkbox"]:checked').length;
    importAddBtn.disabled = checked === 0;
    importAddBtn.textContent = checked === 0
        ? 'Add selected'
        : `Add selected (${checked})`;
};

const selectedImportSets = new Set();
const importSetFilterEl = document.getElementById('import-set-filter');

const renderImportList = () => {
    renderSetFilter(importSetFilterEl, fetchedRemoteDecks, (d) => extractSet(d.leaderId), selectedImportSets, renderImportList);
    importListEl.innerHTML = '';
    for (const [i, deck] of fetchedRemoteDecks.entries()) {
        if (!passesSetFilter(deck, (x) => extractSet(x.leaderId), selectedImportSets)) continue;
        const li = document.createElement('li');
        if (deck.alreadyAdded) li.classList.add('disabled');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.idx = String(i);
        cb.disabled = deck.alreadyAdded;
        cb.addEventListener('change', updateAddButtonState);
        cb.addEventListener('click', (e) => e.stopPropagation());

        li.appendChild(cb);
        li.appendChild(makeThumb(deck.leaderId, true, 'leader'));
        li.appendChild(makeThumb(deck.baseId, false, 'base'));

        const info = document.createElement('div');
        info.className = 'info';
        const name = document.createElement('strong');
        name.textContent = deck.name;
        info.appendChild(name);
        if (deck.leaderId || deck.baseId) {
            const meta = document.createElement('div');
            meta.className = 'meta';
            meta.textContent = [deck.leaderId, deck.baseId].filter(Boolean).join(' / ');
            info.appendChild(meta);
        }
        li.appendChild(info);

        if (deck.alreadyAdded) {
            const tag = document.createElement('span');
            tag.className = 'already-tag';
            tag.textContent = 'already added';
            li.appendChild(tag);
        }

        // Clicking the row toggles the checkbox (except on already-added rows).
        if (!deck.alreadyAdded) {
            li.addEventListener('click', () => {
                cb.checked = !cb.checked;
                updateAddButtonState();
            });
        }
        importListEl.appendChild(li);
    }
    updateAddButtonState();
};

importSelectAllEl.addEventListener('change', () => {
    for (const cb of importListEl.querySelectorAll('input[type="checkbox"]:not(:disabled)')) {
        cb.checked = importSelectAllEl.checked;
    }
    updateAddButtonState();
});

importBtn.addEventListener('click', async () => {
    setImportStatus('Fetching saved decks from karabast.net…');
    importBtn.disabled = true;
    const res = await send({ type: 'fetchKarabastDecks' });
    importBtn.disabled = false;
    if (!res.ok) {
        setImportStatus(res.error, 'error');
        importResultsEl.hidden = true;
        return;
    }
    fetchedRemoteDecks = res.decks || [];
    const newCount = fetchedRemoteDecks.filter((d) => !d.alreadyAdded).length;
    setImportStatus(
        fetchedRemoteDecks.length === 0
            ? 'No decks found on your karabast.net account.'
            : `${fetchedRemoteDecks.length} found · ${newCount} new`
    );
    importSelectAllEl.checked = false;
    importResultsEl.hidden = false;
    renderImportList();
});

importAddBtn.addEventListener('click', async () => {
    const selected = Array.from(importListEl.querySelectorAll('input[type="checkbox"]:checked'))
        .map((cb) => fetchedRemoteDecks[Number(cb.dataset.idx)])
        .filter(Boolean);
    if (selected.length === 0) return;
    importAddBtn.disabled = true;
    const res = await send({ type: 'addKarabastDecks', decks: selected });
    importAddBtn.disabled = false;
    if (!res.ok) {
        setImportStatus(res.error, 'error');
        return;
    }
    setImportStatus(`Added ${res.added} deck${res.added === 1 ? '' : 's'}.`, 'success');
    // Mark the rows we just added so the user sees them grey out without
    // re-fetching from karabast.
    const addedLinks = new Set(selected.map((d) => d.deckLink));
    for (const d of fetchedRemoteDecks) {
        if (addedLinks.has(d.deckLink)) d.alreadyAdded = true;
    }
    renderImportList();
    refresh();
});

addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const deckLink = addForm.elements.deckLink.value.trim();
    const name = addForm.elements.name.value.trim();
    setStatus('Adding deck…');
    const res = await send({ type: 'addDeck', deckLink, name });
    if (!res.ok) {
        setStatus(res.error, 'error');
        return;
    }
    setStatus(`Added “${res.deck.name}”.`, 'success');
    addForm.reset();
    refresh();
});

refresh();
