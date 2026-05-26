const form = document.getElementById('config-form');
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const emptyEl = document.getElementById('empty-decks');

const setStatus = (text, kind = '') => {
    statusEl.textContent = text;
    statusEl.className = `status ${kind}`.trim();
};

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

const setImage = (img, src) => {
    if (!src) {
        img.removeAttribute('src');
        img.style.visibility = 'hidden';
        return;
    }
    img.style.visibility = 'visible';
    img.src = src;
    img.onerror = () => {
        img.style.visibility = 'hidden';
    };
};

let cachedDecks = [];

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
            persist();
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

const hydrate = async () => {
    const { ok, config, error } = await send({ type: 'getConfig' });
    if (!ok) {
        setStatus(error || 'Failed to load config.', 'error');
        return;
    }

    emptyEl.hidden = config.decks.length > 0;
    cachedDecks = config.decks;

    for (const side of ['A', 'B']) {
        const stored = config.sides[side].selectedDeckId;
        const isValid = stored === 'custom' || cachedDecks.some((d) => d.id === stored);
        setDeckValue(side, isValid ? stored : 'custom');
        renderOptions(side);
        bindDropdownTrigger(side);
    }

    form.elements.A_customDeckLink.value = config.sides.A.customDeckLink || '';
    form.elements.B_customDeckLink.value = config.sides.B.customDeckLink || '';
    form.elements.format.value = config.match.format;
    form.elements.cardPool.value = config.match.cardPool;
    form.elements.gamesToWinMode.value = config.match.gamesToWinMode;

    refreshCustomVisibility();

    if (config.session) {
        setStatus(`Session active. Lobby: ${config.session.lobbyId || '(creating…)'}`, 'success');
    }
};

const persist = async () => {
    const { ok, config } = await send({ type: 'getConfig' });
    if (!ok) return;
    const sides = {
        A: {
            ...config.sides.A,
            selectedDeckId: getDeckValue('A'),
            customDeckLink: form.elements.A_customDeckLink.value.trim()
        },
        B: {
            ...config.sides.B,
            selectedDeckId: getDeckValue('B'),
            customDeckLink: form.elements.B_customDeckLink.value.trim()
        }
    };
    const match = {
        format: form.elements.format.value,
        cardPool: form.elements.cardPool.value,
        gamesToWinMode: form.elements.gamesToWinMode.value
    };
    await send({ type: 'saveSides', sides });
    await send({ type: 'saveMatch', match });
};

form.addEventListener('input', persist);
form.addEventListener('change', persist);

startBtn.addEventListener('click', async () => {
    setStatus('Starting session…');
    await persist();
    const res = await send({ type: 'startSession' });
    if (res.ok) {
        setStatus('Session started. Window B will open when the lobby is ready.', 'success');
    } else {
        setStatus(res.error, 'error');
    }
});

stopBtn.addEventListener('click', async () => {
    const res = await send({ type: 'stopSession' });
    if (res.ok) setStatus('Session stopped.');
    else setStatus(res.error, 'error');
});

const openOptions = () => send({ type: 'openOptions' });
document.getElementById('open-options').addEventListener('click', (e) => {
    e.preventDefault();
    openOptions();
});
document.getElementById('open-options-empty').addEventListener('click', openOptions);

document.getElementById('home-link').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://karabast.net/' });
});

hydrate();
