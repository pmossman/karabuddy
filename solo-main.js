(() => {
    const params = new URLSearchParams(location.search);
    const extId = params.get('extId');
    const extSide = params.get('extSide');
    const extDeck = params.get('extDeck');
    const lobbyIdParam = params.get('lobbyId');

    if (extId) {
        const TARGET = 'anonymousUserId';
        let shadow = extId;
        const proto = Storage.prototype;
        const origGet = proto.getItem;
        const origSet = proto.setItem;
        const origRemove = proto.removeItem;
        proto.getItem = function (key) {
            if (this === localStorage && key === TARGET) return shadow;
            return origGet.call(this, key);
        };
        proto.setItem = function (key, value) {
            if (this === localStorage && key === TARGET) {
                shadow = String(value);
                return;
            }
            return origSet.call(this, key, value);
        };
        proto.removeItem = function (key) {
            if (this === localStorage && key === TARGET) {
                shadow = null;
                return;
            }
            return origRemove.call(this, key);
        };
    }

    console.log('[karabast-solo] inject-main loaded', {
        extSide,
        extId: extId?.slice(0, 8),
        hasDeck: !!extDeck,
        lobbyIdParam: lobbyIdParam?.slice(0, 8),
        pathname: location.pathname
    });

    if (!extSide || location.pathname !== '/lobby') {
        console.log('[karabast-solo] not driving lobby — conditions not met');
        return;
    }

    const setReactInputValue = (input, value) => {
        const tracker = input._valueTracker;
        if (tracker) tracker.setValue('');
        const proto = Object.getPrototypeOf(input);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const findLabelByText = (text) => {
        for (const label of document.querySelectorAll('label')) {
            if ((label.textContent || '').trim() === text) return label;
        }
        return null;
    };

    const findImportDeckButton = () => {
        for (const btn of document.querySelectorAll('button')) {
            const text = (btn.textContent || '').trim();
            if (/^(import|load)\s+deck$/i.test(text)) return btn;
        }
        return null;
    };

    const findDeckLinkInputNear = (anchor) => {
        let container = anchor.parentElement;
        while (container && container !== document.body) {
            for (const input of container.querySelectorAll('input[type="text"]')) {
                const v = input.value || '';
                if (v.includes('lobbyId=')) continue;
                const placeholder = (input.placeholder || '').toLowerCase();
                if (placeholder.includes('chat')) continue;
                const role = input.getAttribute('role') || '';
                if (role === 'combobox') continue;
                return input;
            }
            container = container.parentElement;
        }
        return null;
    };

    const waitFor = (predicate, label, timeoutMs = 60000) =>
        new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => predicate();
            const hit = check();
            if (hit) return resolve(hit);
            const observer = new MutationObserver(() => {
                const r = check();
                if (r) {
                    observer.disconnect();
                    clearTimeout(timer);
                    console.log(`[karabast-solo] resolved "${label}" after ${Date.now() - start}ms`);
                    resolve(r);
                }
            });
            const root = document.body || document.documentElement;
            observer.observe(root, { childList: true, subtree: true, characterData: true });
            const timer = setTimeout(() => {
                observer.disconnect();
                reject(new Error(`waitFor "${label}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });

    const findButtonByText = (predicate) => {
        for (const btn of document.querySelectorAll('button')) {
            const text = (btn.textContent || '').trim();
            if (predicate(text) && !btn.disabled) return btn;
        }
        return null;
    };

    const driveSideBDeckLoad = async () => {
        console.log('[karabast-solo] waiting for New Deck radio…');
        const newDeckLabel = await waitFor(() => findLabelByText('New Deck'), 'New Deck label');
        newDeckLabel.click();
        console.log('[karabast-solo] clicked New Deck radio');

        console.log('[karabast-solo] waiting for import button + deck input…');
        const { button, input } = await waitFor(() => {
            const b = findImportDeckButton();
            if (!b || b.disabled) return null;
            const i = findDeckLinkInputNear(b);
            if (!i) return null;
            return { button: b, input: i };
        }, 'import button + input');

        setReactInputValue(input, extDeck);
        await new Promise((r) => setTimeout(r, 300));
        button.click();
        console.log('[karabast-solo] clicked import deck');
    };

    const autoReadyAndStart = async () => {
        console.log('[karabast-solo] waiting for Ready button…');
        const readyBtn = await waitFor(
            () => findButtonByText((t) => /^ready$/i.test(t)),
            'Ready button'
        );
        readyBtn.click();
        console.log('[karabast-solo] clicked Ready');

        if (extSide !== 'A') return;

        console.log('[karabast-solo] waiting for Start Game button…');
        const startBtn = await waitFor(
            () => findButtonByText((t) => /^start game$/i.test(t)),
            'Start Game button'
        );
        startBtn.click();
        console.log('[karabast-solo] clicked Start Game');
    };

    const driveLobby = async () => {
        try {
            if (extSide === 'B' && extDeck && lobbyIdParam) {
                await driveSideBDeckLoad();
            }
            await autoReadyAndStart();
        } catch (err) {
            console.error('[karabast-solo]', err);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', driveLobby, { once: true });
    } else {
        driveLobby();
    }
})();
