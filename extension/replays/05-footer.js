// karabuddy.replays.Footer — floating launcher that grows in place.
//
// Single draggable element with two states:
//   - collapsed: header bar only (KARA/buddy mark + optional REC indicator);
//                cursor: grab; mousedown→drag, click→expand.
//   - expanded:  same header + body content underneath; the whole element
//                stays one DOM node, drag still works from the header.
//
// Body content branches on recording state at expand time:
//   - idle      → KaraBuddy links into karabuddy.app (replaces popup role)
//   - recording → REC + tag controls + recent tags + open-on-karabuddy link
//
// Edge-detection on expand: if the expanded element would overflow the
// viewport, we shift its top-left so it fits. The shift is not restored
// on collapse — the user accepted the new position (and can drag from
// there). Persistence happens only on user-initiated drags.
//
// Identities preserved for downstream consumers:
//   - #karabast-replays-launcher  — root container. 07-toast.js reads
//     this element's getBoundingClientRect() to anchor pills.
//   - NS.Footer.{refreshOverlay,updateOverlay,refreshFooter} — Recorder
//     calls these on every event; we route them all to the same repaint.
(() => {
    const NS = ((window.__KaraBuddy ||= {}).replays ||= {});
    const R = () => NS.Recorder;
    const B = () => NS.bridge;
    const D = () => NS.Decoder;
    const T = () => NS.toast; // toast accessor (was referenced below but undefined)

    // ----- Layout constants -----
    const LAUNCHER_ID = 'karabast-replays-launcher';
    const LAUNCHER_POS_STORAGE_KEY = 'karabuddyLauncherPos';
    const LAUNCHER_DRAG_THRESHOLD = 4; // pixels of total movement before click → drag
    const LAUNCHER_MIN_HEIGHT = 28;

    const EXPANDED_WIDTH = 300;
    const RECENT_TAGS_MAX = 5;
    const VIEWPORT_PADDING = 8;

    // ----- Page-level styles (animations only — everything else is inline). -----
    const installFooterStyles = () => {
        if (document.getElementById('karabast-replays-frame-styles')) return;
        const style = document.createElement('style');
        style.id = 'karabast-replays-frame-styles';
        style.textContent = `
            @keyframes karabast-rec-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.35; }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    };

    // installFrame is a no-op post-B20 — the playback frame wrapper went with
    // 04-playback.js. Kept exported so 06-bootstrap.js doesn't need conditional
    // plumbing if a future feature wants it back.
    const installFrame = () => {};

    // ----- Position helpers -----
    const clampPos = (x, y, w, h) => {
        const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - w - VIEWPORT_PADDING);
        const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - h - VIEWPORT_PADDING);
        return {
            x: Math.min(Math.max(VIEWPORT_PADDING, x), maxX),
            y: Math.min(Math.max(VIEWPORT_PADDING, y), maxY)
        };
    };

    const applyPos = (el, x, y) => {
        const rect = el.getBoundingClientRect();
        const { x: cx, y: cy } = clampPos(x, y, rect.width, rect.height);
        el.style.left = cx + 'px';
        el.style.top = cy + 'px';
    };

    const isRecordingActive = () => {
        const r = R();
        if (!r) return false;
        return typeof r.isRecordingActive === 'function'
            ? r.isRecordingActive()
            : r.getRecordingLength() > 0;
    };

    // ----- State -----
    let expanded = false;
    let mode = null; // 'idle' | 'recording' when expanded
    let outsideMousedownHandler = null;

    // B67: persistent "share this match's replay with team(s)" selection.
    // Lives in chrome.storage.local so it survives reloads + applies to
    // every subsequent match until the user toggles it back off.
    //   karabuddyShareTeamSlugs:    string[]  active selection
    //   karabuddyLastShareTeamSlugs string[]  last non-empty selection;
    //                                          used to restore on toggle
    let shareTeamSlugs = [];
    let lastShareTeamSlugs = [];
    // B170 / ADR 0010: team_key_ids for which a private-team key is loaded in the
    // extension (chrome.storage.local, SW-held). Refreshed each share-panel
    // render via the bridge; drives the per-team "key loaded / needs key" chip.
    // The key bytes themselves NEVER come back across the bridge.
    let privateKeyIdsLoaded = [];
    // B170 / ADR 0010: cached privacy decision for the armed teams (from the SW's
    // decideUploadMode — single source of truth) driving the header share-status
    // chip. Refreshed on share/key changes + lazily on first paint, NOT per tick.
    let privacyStatus = null;
    // B170: slug → team (with privateMode/teamKeyId), cached on each share-panel
    // load so the toggle can enforce arming coherence without a refetch.
    let cachedTeamsBySlug = new Map();

    // B170 / ADR 0010 — arming a private team is EXCLUSIVE: a replay is encrypted
    // under ONE team key, so it can't also go to an open team (which can't
    // decrypt) or a private team with a different key. Given the just-armed team,
    // drop every armed slug that's incompatible with it. Pure on the slug list.
    const coerceArmExclusive = (justArmedSlug, slugs, bySlug) => {
        const anchor = bySlug.get(justArmedSlug);
        if (!anchor) return slugs;
        if (anchor.privateMode) {
            // keep only same-key private teams (the just-armed one included)
            return slugs.filter((s) => {
                const t = bySlug.get(s);
                return s === justArmedSlug || (t && t.privateMode && t.teamKeyId === anchor.teamKeyId);
            });
        }
        // open team armed → drop any private teams
        return slugs.filter((s) => {
            const t = bySlug.get(s);
            return s === justArmedSlug || !(t && t.privateMode);
        });
    };

    // Sanitize a persisted set to that same invariant (anchor on the first armed
    // private team, if any). Used on load so a legacy incoherent selection can't
    // linger.
    const coerceCoherent = (slugs, bySlug) => {
        const firstPrivate = slugs.find((s) => bySlug.get(s)?.privateMode);
        return firstPrivate ? coerceArmExclusive(firstPrivate, slugs, bySlug) : slugs;
    };

    const SHARE_STORAGE_KEY = 'karabuddyShareTeamSlugs';
    const SHARE_LAST_STORAGE_KEY = 'karabuddyLastShareTeamSlugs';
    // B80: opt-out for the content-free karabast-drift beacon (default OFF =
    // participating). The SW (background.js) reads this same key before sending.
    const HEALTH_OPTOUT_KEY = 'karabuddyHealthOptOut';

    // B76: chrome.storage.local is unavailable in this MAIN-world content
    // script, so route it through the SW bridge. This is what makes the local
    // cache (share state, launcher position) actually persist across reloads —
    // the old direct chrome.storage.local calls here silently no-op'd.
    //   lsGet(keys) → Promise<object>  (the stored values; {} on failure)
    //   lsSet(items) → fire-and-forget
    const lsGet = (keys) => {
        const bridge = B();
        if (!bridge || !bridge.storageGet) return Promise.resolve({});
        // companionRequest already unwraps to the SW response's `data` (the
        // stored values), so use the resolved value directly — do NOT re-unwrap
        // (resp.data here would be undefined; that was the persistence bug).
        return bridge.storageGet(keys).then((res) => res || {}).catch(() => ({}));
    };
    const lsSet = (items) => {
        const bridge = B();
        if (bridge && bridge.storageSet) bridge.storageSet(items);
    };

    // B79: the unwrap-sensitive reads/writes live in NS.shareStore (04-share-
    // store.js) so they're pure + unit-tested. The footer just orchestrates:
    // show the local cache fast, then let the server (when signed in) override.
    const syncShareStateFromServer = () => {
        NS.shareStore.loadServerArmed(B()).then((res) => {
            if (!res) return; // not signed in / unavailable → keep local
            shareTeamSlugs = res.shareTeamSlugs;
            if (shareTeamSlugs.length > 0) lastShareTeamSlugs = [...shareTeamSlugs];
            // Mirror the server value into the local cache for offline reloads.
            const payload = { [SHARE_STORAGE_KEY]: shareTeamSlugs };
            if (shareTeamSlugs.length > 0) payload[SHARE_LAST_STORAGE_KEY] = lastShareTeamSlugs;
            lsSet(payload);
            refreshFooter();
            refreshSharePanel();
        }).catch(() => {});
    };

    const loadShareState = () => {
        NS.shareStore.loadLocalArmed(B()).then((r) => {
            if (r.shareTeamSlugs) shareTeamSlugs = r.shareTeamSlugs;
            if (r.lastShareTeamSlugs) lastShareTeamSlugs = r.lastShareTeamSlugs;
            refreshFooter();
        });
        syncShareStateFromServer();
    };

    const persistShareState = () => {
        // Only update lastShareTeamSlugs when we have a non-empty selection so
        // toggling OFF doesn't wipe the restore target.
        if (shareTeamSlugs.length > 0) lastShareTeamSlugs = [...shareTeamSlugs];
        NS.shareStore.persistArmed(B(), shareTeamSlugs, lastShareTeamSlugs);
    };

    // Public-ish accessor — the recorder reads this after every successful
    // upload to know which teams to apply shares for.
    const getShareTeamSlugs = () => [...shareTeamSlugs];

    // B69: cached signed-in account info. Loaded lazily on first expand
    // via the bridge → SW → /api/me/whoami path (install-token header
    // auth, so SameSite cookie quirks don't bite). 5-min TTL — fresh
    // enough to catch karabastUsername changes, stale enough not to
    // hammer the API.
    let whoamiCache = null;
    let whoamiLoadedAt = 0;
    let whoamiInflight = null;
    const WHOAMI_TTL_MS = 5 * 60 * 1000;
    const loadWhoami = async (force = false) => {
        if (!force && whoamiCache && Date.now() - whoamiLoadedAt < WHOAMI_TTL_MS) {
            return whoamiCache;
        }
        if (whoamiInflight) return whoamiInflight;
        whoamiInflight = (async () => {
            try {
                NS.dlog('[karabuddy:karabast] bubble: fetching whoami via SW');
                const result = await B().getWhoami?.();
                NS.dlog('[karabuddy:karabast] bubble: whoami result', result);
                // companionRequest already unwraps to `data` from the
                // SW response, so `result` IS the API body. Don't
                // double-unwrap.
                if (result && result.ok && result.user) {
                    whoamiCache = result.user;
                    whoamiLoadedAt = Date.now();
                    return whoamiCache;
                }
                whoamiCache = { displayName: null, signedOut: true };
                whoamiLoadedAt = Date.now();
                return whoamiCache;
            } catch (err) {
                NS.dwarn('[karabuddy:karabast] bubble: whoami failed', err);
                return null;
            } finally {
                whoamiInflight = null;
            }
        })();
        return whoamiInflight;
    };

    // B69: open karabuddy sign-in in a popup window. Doesn't interrupt
    // the karabast match — the popup lives in its own window, the user
    // signs in (Discord/Google), karabuddy.app's ExtensionSigninReturn
    // component detects the `fromExtension=1` callback and closes the
    // popup. We poll popup.closed too in case the user closes manually.
    const openSigninPopup = async () => {
        const endpointResult = await B().getEndpoint?.();
        const endpoint = endpointResult?.endpoint || 'https://karabuddy.app';
        const callbackUrl = encodeURIComponent('/?fromExtension=1');
        const url = `${endpoint}/signin?callbackUrl=${callbackUrl}`;
        // 600x750 fits both Discord + Google's OAuth pages comfortably.
        const popup = window.open(url, 'karabuddy-signin', 'popup,width=600,height=750');
        if (!popup) {
            // Popup blocked — fall back to opening in a regular tab.
            window.open(url, '_blank');
            return;
        }
        // Two-track close detection so we always notice + refresh:
        //   1. postMessage from the karabuddy "you can close now" page
        //   2. polled popup.closed (handles manual close + cases where
        //      postMessage doesn't fire e.g. due to cross-origin blockers)
        const onSignedInMessage = (e) => {
            const data = e.data;
            if (!data || data.type !== 'karabuddy:signedIn') return;
            try { popup.close(); } catch {}
        };
        window.addEventListener('message', onSignedInMessage);
        const poll = setInterval(() => {
            if (!popup.closed) return;
            clearInterval(poll);
            window.removeEventListener('message', onSignedInMessage);
            // Bust the cache + repaint.
            whoamiCache = null;
            refreshWhoamiBlock();
        }, 400);
    };

    const refreshWhoamiBlock = async () => {
        const block = document.getElementById('karabast-replays-panel-whoami');
        if (!block) return;
        block.replaceChildren();
        block.style.color = '#6c7588';
        block.style.fontStyle = 'normal';
        const data = await loadWhoami();
        if (!block.isConnected) return; // panel closed mid-fetch
        if (!data || data.signedOut) {
            const note = document.createElement('div');
            note.setAttribute('style', 'font-style: italic; margin-bottom: 6px;');
            note.textContent = 'Not signed in to karabuddy.';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'Sign in on karabuddy →';
            btn.setAttribute('style', [
                'background: rgba(77, 157, 255, 0.18)',
                'color: #d6e7ff',
                'border: 1px solid #4d9dff',
                'border-radius: 6px',
                'padding: 7px 10px',
                'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
                'cursor: pointer',
                'width: 100%',
                'text-align: center'
            ].join(';'));
            btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openSigninPopup();
            });
            block.appendChild(note);
            block.appendChild(btn);
            return;
        }
        block.style.color = '#a7d2ff';
        block.textContent = `Signed in as ${data.displayName || 'unknown'}`;
    };

    const buildWhoamiBlock = () => {
        const el = document.createElement('div');
        el.id = 'karabast-replays-panel-whoami';
        el.setAttribute('style', [
            'font: 600 11px -apple-system, BlinkMacSystemFont, sans-serif',
            'color: #6c7588',
            'padding-top: 10px',
            'border-top: 1px solid #2e333c'
        ].join(';'));
        el.textContent = 'Loading account…';
        requestAnimationFrame(() => { refreshWhoamiBlock(); });
        return el;
    };

    // Re-render the expanded panel's share section. Called after toggles
    // so the checklist reflects current state without rebuilding the
    // whole panel.
    const refreshSharePanel = async () => {
        const section = document.getElementById('karabast-replays-panel-share-section');
        if (!section) return;
        const list = document.getElementById('karabast-replays-panel-share-list');
        if (!list) return;
        list.innerHTML = '';
        const data = await loadMentionData();
        // B170: refresh which private-team keys are loaded (kids only).
        try { privateKeyIdsLoaded = (await B().listPrivateTeamKeyIds?.()) || []; }
        catch { privateKeyIdsLoaded = []; }
        const teams = data?.teams || [];
        // Cache for the toggle's exclusivity check, and heal any legacy
        // incoherent selection (e.g. a private + open team both armed before
        // exclusivity was enforced) so the rows can't show contradictory state.
        cachedTeamsBySlug = new Map(teams.map((t) => [t.slug, t]));
        const coherent = coerceCoherent(shareTeamSlugs, cachedTeamsBySlug);
        if (coherent.length !== shareTeamSlugs.length) { shareTeamSlugs = coherent; persistShareState(); }
        if (teams.length === 0) {
            const empty = document.createElement('div');
            empty.setAttribute('style', 'font-size: 11px; color: #6c7588; font-style: italic; padding: 4px 0;');
            empty.textContent = data
                ? "You're not in any teams yet. Join a team on karabuddy.app to share."
                : 'Sign in on karabuddy.app to see your teams.';
            list.appendChild(empty);
            return;
        }
        for (const team of teams) {
            list.appendChild(buildShareRow(team));
        }
        // B170: an explicit, clearly-a-button entry to the key manager (the row
        // badges are status only). Shown when the user is on any private team.
        if (teams.some((t) => t.privateMode)) {
            const manage = document.createElement('button');
            manage.type = 'button';
            manage.textContent = '🔑 Manage private team keys';
            manage.setAttribute('style', [
                'margin-top: 4px', 'align-self: flex-start', 'cursor: pointer',
                'padding: 2px 0', 'background: transparent', 'border: 0',
                'font: 600 11px -apple-system, BlinkMacSystemFont, sans-serif',
                'color: #8a93a3', 'text-align: left',
            ].join(';'));
            manage.addEventListener('mouseenter', () => { manage.style.color = '#cfe6ff'; });
            manage.addEventListener('mouseleave', () => { manage.style.color = '#8a93a3'; });
            manage.addEventListener('mousedown', (e) => e.stopPropagation());
            manage.addEventListener('click', (e) => { e.stopPropagation(); B().openKeyManager?.(); });
            list.appendChild(manage);
        }
        // B170: arming/disarming a team or loading/forgetting a key changes the
        // privacy decision — refresh the header chip to match.
        refreshPrivacyStatus();
    };


    // Tactical-panel row: status LED + monospace team name + ARMED /
    // STANDBY label. Click anywhere on the row toggles. Replaces the
    // native checkbox so the bubble reads as a cockpit control rather
    // than a settings form.
    // B170: a small padlock (monochrome inline SVG, so its colour conveys state)
    // shown to the right of a PRIVATE team's name — the eye-catch for "what's the
    // encryption status here?". Paired with a short label + an INSTANT custom
    // tooltip (attachTooltip) for the full explanation.
    const lockIcon = (color) => {
        // Built via the DOM (not innerHTML) so there's no dynamic-innerHTML lint
        // flag — `color` is set as an attribute, never interpolated into markup.
        const SVGNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(SVGNS, 'svg');
        svg.setAttribute('width', '13'); svg.setAttribute('height', '13');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('aria-hidden', 'true');
        const rect = document.createElementNS(SVGNS, 'rect');
        rect.setAttribute('x', '4.5'); rect.setAttribute('y', '10.5'); rect.setAttribute('width', '15');
        rect.setAttribute('height', '10'); rect.setAttribute('rx', '2.2'); rect.setAttribute('stroke', color); rect.setAttribute('stroke-width', '2');
        const path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('d', 'M8 10.5V8a4 4 0 0 1 8 0v2.5'); path.setAttribute('stroke', color); path.setAttribute('stroke-width', '2');
        svg.append(rect, path);
        const span = document.createElement('span');
        span.setAttribute('style', 'flex: 0 0 auto; display: inline-flex; align-items: center;');
        span.append(svg);
        return span;
    };

    // B170: an INSTANT custom tooltip (the native `title` lags ~1s). One shared
    // floating element, positioned above the hovered target (flipped below if it
    // would clip the top). pointer-events:none so it never eats hovers.
    let tooltipEl = null;
    const getTooltip = () => {
        if (tooltipEl && tooltipEl.isConnected) return tooltipEl;
        tooltipEl = document.createElement('div');
        tooltipEl.setAttribute('style', [
            'position: fixed', 'z-index: 2147483647', 'max-width: 240px', 'display: none',
            'background: #0b0e13', 'border: 1px solid #2e333c', 'border-radius: 6px',
            'padding: 7px 9px', 'font: 500 11px -apple-system, BlinkMacSystemFont, sans-serif',
            'color: #d6dbe4', 'line-height: 1.4', 'box-shadow: 0 4px 14px rgba(0,0,0,0.55)',
            'pointer-events: none',
        ].join(';'));
        document.body.appendChild(tooltipEl);
        return tooltipEl;
    };
    const attachTooltip = (el, text) => {
        el.addEventListener('mouseenter', () => {
            const tip = getTooltip();
            tip.textContent = text;
            tip.style.display = 'block';
            const r = el.getBoundingClientRect();
            const tr = tip.getBoundingClientRect();
            let top = r.top - tr.height - 6;
            if (top < 4) top = r.bottom + 6; // flip below if no room above
            let left = Math.max(4, r.right - tr.width);
            if (left + tr.width > window.innerWidth - 4) left = window.innerWidth - tr.width - 4;
            tip.style.top = top + 'px';
            tip.style.left = left + 'px';
        });
        el.addEventListener('mouseleave', () => { if (tooltipEl) tooltipEl.style.display = 'none'; });
    };

    // B170 / ADR 0010: the active arming "mode" derived from the current set —
    // a private game is encrypted under ONE key, so it can't mix with open teams
    // or a different-key private team. → { type:'private', kid } | { type:'open' }
    // | { type:'none' }.
    const getArmedMode = () => {
        let kid = null;
        let hasOpen = false;
        for (const s of shareTeamSlugs) {
            const t = cachedTeamsBySlug.get(s);
            if (!t) continue;
            if (t.privateMode) { if (!kid) kid = t.teamKeyId || '∅'; }
            else hasOpen = true;
        }
        if (kid) return { type: 'private', kid };
        if (hasOpen) return { type: 'open' };
        return { type: 'none' };
    };

    const buildShareRow = (team) => {
        const armed = shareTeamSlugs.includes(team.slug);
        const keyLoaded = team.privateMode ? (!!team.teamKeyId && privateKeyIdsLoaded.includes(team.teamKeyId)) : true;
        // B170: armed private team with NO key → WARNING state. The replay won't
        // upload (stays local) until the key is loaded, so the whole row goes
        // amber instead of the healthy cyan "armed" treatment — crystal clear.
        const needsKey = armed && team.privateMode && !keyLoaded;

        // B170: rows INCOMPATIBLE with what's already armed are disabled (greyed,
        // not clickable) with a reason — mirroring the replay viewer's share UI.
        // Arming a private team disables open + different-key private teams (and
        // vice versa); to switch, un-arm the current pick (armed rows stay live).
        const mode = getArmedMode();
        let disabled = false;
        let disabledTitle = ''; // full sentence shown on hover — no shorthand text
        if (!armed) {
            if (mode.type === 'private') {
                if (!team.privateMode) { disabled = true; disabledTitle = 'A private team is armed — its encrypted replay can’t also go to an open team. Un-arm the private team to share here.'; }
                else if ((team.teamKeyId || '∅') !== mode.kid) { disabled = true; disabledTitle = 'A different private team is armed — un-arm it to record for this team instead.'; }
            } else if (mode.type === 'open' && team.privateMode) {
                disabled = true; disabledTitle = 'An open team is armed — un-arm it to record privately for this team.';
            }
        }

        const accent = needsKey ? '#ffb020' : (armed ? '#4dd2ff' : '#3a4150');
        const armedBg = needsKey ? 'rgba(255, 176, 32, 0.10)' : 'rgba(77, 210, 255, 0.08)';
        const row = document.createElement('div');
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', disabled ? '-1' : '0');
        row.setAttribute('aria-pressed', armed ? 'true' : 'false');
        if (disabled) row.setAttribute('aria-disabled', 'true');
        row.setAttribute('style', [
            'display: flex',
            'align-items: center',
            'gap: 9px',
            'padding: 6px 9px',
            'background: ' + (armed ? armedBg : 'rgba(255, 255, 255, 0.02)'),
            'border-left: 2px solid ' + accent,
            'cursor: ' + (disabled ? 'not-allowed' : 'pointer'),
            'opacity: ' + (disabled ? '0.45' : '1'),
            'transition: background 120ms ease, border-color 120ms ease'
        ].join(';'));
        row.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        if (!disabled) {
            row.addEventListener('mouseenter', () => {
                if (!shareTeamSlugs.includes(team.slug)) {
                    row.style.background = 'rgba(77, 210, 255, 0.04)';
                }
            });
            row.addEventListener('mouseleave', () => {
                const stillArmed = shareTeamSlugs.includes(team.slug);
                row.style.background = stillArmed ? armedBg : 'rgba(255, 255, 255, 0.02)';
            });
        }
        const toggle = () => {
            if (disabled) return;
            if (shareTeamSlugs.includes(team.slug)) {
                shareTeamSlugs = shareTeamSlugs.filter((s) => s !== team.slug);
            } else {
                shareTeamSlugs.push(team.slug);
            }
            persistShareState();
            refreshFooter();
            refreshSharePanel();
        };
        row.addEventListener('click', toggle);
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
        });

        // LED indicator. Ring + center dot; dot lit only when armed,
        // with a soft glow shadow on the ring to sell the "live signal"
        // read.
        const led = document.createElement('span');
        const ledGlow = needsKey
            ? '0 0 6px rgba(255, 176, 32, 0.75), inset 0 0 4px rgba(255, 176, 32, 0.5)'
            : (armed ? '0 0 6px rgba(77, 210, 255, 0.7), inset 0 0 4px rgba(77, 210, 255, 0.45)' : 'inset 0 0 2px rgba(0,0,0,0.6)');
        led.setAttribute('style', [
            'display: inline-flex',
            'align-items: center',
            'justify-content: center',
            'width: 12px',
            'height: 12px',
            'border-radius: 50%',
            'border: 1.5px solid ' + accent,
            'background: rgba(0, 0, 0, 0.45)',
            'box-shadow: ' + ledGlow,
            'flex: 0 0 auto',
            'transition: box-shadow 120ms ease, border-color 120ms ease'
        ].join(';'));
        if (needsKey) {
            // Warning bang instead of the healthy dot.
            const bang = document.createElement('span');
            bang.setAttribute('style', 'font: 900 9px -apple-system, BlinkMacSystemFont, sans-serif; color: #ffb020; line-height: 1;');
            bang.textContent = '!';
            led.appendChild(bang);
        } else if (armed) {
            const dot = document.createElement('span');
            dot.setAttribute('style', [
                'display: block',
                'width: 5px',
                'height: 5px',
                'border-radius: 50%',
                'background: #4dd2ff',
                'box-shadow: 0 0 4px #4dd2ff'
            ].join(';'));
            led.appendChild(dot);
        }

        // Team name in tactical-display monospace.
        const name = document.createElement('span');
        name.setAttribute('style', [
            'flex: 1 1 auto',
            'min-width: 0',
            'overflow: hidden',
            'text-overflow: ellipsis',
            'white-space: nowrap',
            'font: 600 12px "SF Mono", Menlo, Consolas, monospace',
            'color: ' + (needsKey ? '#ffd98a' : (armed ? '#d6f0ff' : '#a8b0bd')),
            'letter-spacing: 0.02em'
        ].join(';'));
        name.textContent = team.name;

        row.appendChild(led);
        row.appendChild(name);

        // Right side. A PRIVATE team gets a lock icon + a SHORT visible label
        // (so the state — esp. the missing-key warning — reads at a glance), with
        // an INSTANT custom tooltip carrying the full explanation. An armed OPEN
        // team gets a quiet "SHARING". A disabled OPEN team explains on row hover.
        if (team.privateMode) {
            const st = disabled
                ? { color: '#6c7588', word: 'Locked', full: disabledTitle }
                : keyLoaded
                    ? { color: '#4dd2ff', word: armed ? 'Encrypted' : 'Key loaded', full: armed ? 'This match will be encrypted for this team before upload — KaraBuddy can’t read it.' : 'Team key loaded on this device — replays for this team open automatically.' }
                    : { color: '#ffb020', word: 'No key', full: armed ? 'No key on this device — this match stays local and won’t upload until you load the team key.' : 'Private team — its key isn’t loaded on this device. Load it to record or view replays.' };
            const wrap = document.createElement('span');
            wrap.setAttribute('style', 'display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto;');
            wrap.appendChild(lockIcon(st.color));
            const word = document.createElement('span');
            word.setAttribute('style', `font: 700 9px "SF Mono", Menlo, Consolas, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: ${st.color};`);
            word.textContent = st.word;
            wrap.appendChild(word);
            attachTooltip(wrap, st.full);
            row.appendChild(wrap);
        } else if (armed) {
            const status = document.createElement('span');
            status.setAttribute('style', [
                'font: 700 9px "SF Mono", Menlo, Consolas, monospace',
                'color: #4dd2ff', 'letter-spacing: 0.18em', 'text-transform: uppercase', 'flex: 0 0 auto',
            ].join(';'));
            status.textContent = 'Sharing';
            row.appendChild(status);
        } else if (disabled) {
            attachTooltip(row, disabledTitle);
        }

        return row;
    };

    // Build the share section. Used by both idle and recording bodies.
    const buildShareSection = () => {
        const section = document.createElement('div');
        section.id = 'karabast-replays-panel-share-section';
        section.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid #2e333c;');

        const label = document.createElement('div');
        label.setAttribute('style', 'font: 600 10px -apple-system, BlinkMacSystemFont, sans-serif; color: #6c7588; letter-spacing: 0.08em; text-transform: uppercase;');
        label.textContent = 'Share with teams';
        section.appendChild(label);

        const hint = document.createElement('div');
        hint.setAttribute('style', 'font-size: 11px; color: #6c7588; line-height: 1.4;');
        hint.textContent = 'Replays from this match (and future matches) will surface in checked teams. Stays on until you toggle off.';
        section.appendChild(hint);

        const list = document.createElement('div');
        list.id = 'karabast-replays-panel-share-list';
        list.setAttribute('style', 'display: flex; flex-direction: column; gap: 4px;');
        section.appendChild(list);

        // Kick off async render; the section element returns synchronously
        // so the panel layout doesn't jank.
        requestAnimationFrame(() => { refreshSharePanel(); });

        return section;
    };

    // ----- Build the launcher (single root element with header + body) -----
    const buildLauncher = () => {
        const root = document.createElement('div');
        root.id = LAUNCHER_ID;
        root.setAttribute('style', [
            'position: fixed',
            'top: 10px',
            'left: 10px',
            'z-index: 2147483646',
            'min-height: ' + LAUNCHER_MIN_HEIGHT + 'px',
            'border-radius: 10px',
            'background: linear-gradient(140deg, #243044 0%, #1a1d23 100%)',
            'border: 1px solid rgba(77, 157, 255, 0.5)',
            'box-shadow: 0 2px 12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0,0,0,0.3)',
            'color: #e6e6e6',
            'font: 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'display: flex',
            'flex-direction: column',
            'overflow: hidden',
            'transition: width 140ms ease, border-color 120ms ease',
            'touch-action: none',
            'user-select: none'
        ].join(';'));

        // Restore persisted position (B76: via the SW-routed local cache).
        lsGet([LAUNCHER_POS_STORAGE_KEY]).then((res) => {
            const pos = res && res[LAUNCHER_POS_STORAGE_KEY];
            if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
                applyPos(root, pos.x, pos.y);
            }
        });

        root.appendChild(buildHeader(root));
        root.appendChild(buildBody());
        return root;
    };

    // Header bar: KARA/buddy lockup + REC indicator + (when expanded) × close.
    // Doubles as the drag handle and the click-to-toggle surface.
    const buildHeader = (root) => {
        const header = document.createElement('div');
        header.id = 'karabast-replays-launcher-header';
        header.setAttribute('style', [
            'display: flex',
            'align-items: center',
            'gap: 6px',
            'padding: 0 7px',
            'height: ' + LAUNCHER_MIN_HEIGHT + 'px',
            'flex: 0 0 auto',
            'cursor: grab'
        ].join(';'));

        header.addEventListener('mouseenter', () => {
            root.style.borderColor = 'rgba(90, 140, 255, 0.85)';
        });
        header.addEventListener('mouseleave', () => {
            root.style.borderColor = 'rgba(77, 157, 255, 0.5)';
        });

        // KARA/buddy stacked lockup.
        const mono = document.createElement('span');
        mono.setAttribute('style', [
            'display: flex',
            'flex-direction: column',
            'align-items: flex-start',
            'line-height: 0.95',
            'padding: 0 1px',
            'flex: 0 0 auto',
            'pointer-events: none'
        ].join(';'));
        const monoMain = document.createElement('span');
        monoMain.setAttribute('style', 'font: 400 10px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif; color: #fff; letter-spacing: 0; text-transform: uppercase;');
        monoMain.textContent = 'KARA';
        const monoSub = document.createElement('span');
        monoSub.setAttribute('style', 'font: italic 700 8px Georgia, "Times New Roman", serif; color: #5db4ff; letter-spacing: -0.01em; margin-left: 4px; margin-top: -1px;');
        monoSub.textContent = 'buddy';
        mono.appendChild(monoMain);
        mono.appendChild(monoSub);

        // REC indicator — hidden until recording, revealed by refreshFooter.
        const recWrap = document.createElement('span');
        recWrap.id = 'karabast-replays-launcher-rec';
        recWrap.setAttribute('style', [
            'display: none',
            'align-items: center',
            'gap: 4px',
            'padding-left: 5px',
            'border-left: 1px solid rgba(255,255,255,0.12)',
            'flex: 0 0 auto',
            'pointer-events: none'
        ].join(';'));
        const recDot = document.createElement('span');
        recDot.setAttribute('style', 'display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #ff4040; box-shadow: 0 0 5px #ff4040; animation: karabast-rec-pulse 1.4s ease-in-out infinite;');
        const recCount = document.createElement('span');
        recCount.id = 'karabast-replays-launcher-rec-count';
        recCount.setAttribute('style', 'font: 600 9px -apple-system, BlinkMacSystemFont, sans-serif; color: #d6e7ff; letter-spacing: 0.04em;');
        recCount.textContent = 'REC';
        recWrap.appendChild(recDot);
        recWrap.appendChild(recCount);

        // B67: team-share indicator — green dot when this match's replay
        // will be auto-shared with one or more teams. Clickable: toggles
        // OFF if currently sharing; if currently private, restores the
        // last non-empty selection (or expands the panel to pick teams
        // if there's no prior selection to restore).
        // B170: unified SHARE-STATUS chip — visible whenever ≥1 team is armed,
        // collapsed OR expanded (the armed selection is persistent). Shows an icon
        // for the state + the team count: ● N (sharing/open), 🔒 N (encrypting),
        // ⚠ N (private team armed but no key → won't upload). Click opens the
        // panel to manage. Driven by privacyStatus via updateShareStatus().
        const shareWrap = document.createElement('button');
        shareWrap.id = 'karabast-replays-launcher-share';
        shareWrap.type = 'button';
        shareWrap.setAttribute('style', [
            'display: none',
            'align-items: center',
            'gap: 4px',
            'padding: 0 5px',
            'border-left: 1px solid rgba(255,255,255,0.12)',
            'background: transparent',
            'border-top: 0',
            'border-right: 0',
            'border-bottom: 0',
            'color: inherit',
            'cursor: pointer',
            'flex: 0 0 auto',
            'height: 100%'
        ].join(';'));
        const shareLabel = document.createElement('span');
        shareLabel.id = 'karabast-replays-launcher-share-label';
        shareLabel.setAttribute('style', 'font: 700 10px -apple-system, BlinkMacSystemFont, sans-serif; letter-spacing: 0.04em;');
        shareWrap.appendChild(shareLabel);
        shareWrap.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        shareWrap.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!expanded) expand();
        });

        // Spacer pushes × to the right when expanded.
        const spacer = document.createElement('span');
        spacer.setAttribute('style', 'flex: 1 1 auto;');

        // × close button — hidden when collapsed.
        const closeBtn = document.createElement('button');
        closeBtn.id = 'karabast-replays-launcher-close';
        closeBtn.type = 'button';
        closeBtn.title = 'Collapse';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('style', [
            'display: none',
            'background: transparent',
            'color: #a0a8b8',
            'border: 0',
            'padding: 0',
            'width: 18px',
            'height: 18px',
            'font: 15px -apple-system, BlinkMacSystemFont, sans-serif',
            'line-height: 1',
            'cursor: pointer',
            'border-radius: 4px',
            'flex: 0 0 auto'
        ].join(';'));
        closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#e6e6e6'; });
        closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#a0a8b8'; });
        closeBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            collapse();
        });

        header.appendChild(mono);
        header.appendChild(recWrap);
        header.appendChild(shareWrap);
        header.appendChild(spacer);
        header.appendChild(closeBtn);

        // Drag + click handling on the header. Works in both collapsed and
        // expanded states — the whole launcher (header + body) moves together.
        attachDragAndToggle(header, root);

        return header;
    };

    // Body container — populated fresh on each expand, hidden when collapsed.
    const buildBody = () => {
        const body = document.createElement('div');
        body.id = 'karabast-replays-launcher-body';
        body.setAttribute('style', [
            'display: none',
            'flex-direction: column',
            'gap: 12px',
            'padding: 0 14px 12px',
            'max-height: calc(80vh - ' + LAUNCHER_MIN_HEIGHT + 'px)',
            'overflow-y: auto',
            'opacity: 0',
            'transition: opacity 140ms ease'
        ].join(';'));
        return body;
    };

    // ----- Drag + click-toggle on the header -----
    const attachDragAndToggle = (header, root) => {
        let drag = null;

        const onMove = (e) => {
            if (!drag) return;
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
            if (drag.moved >= LAUNCHER_DRAG_THRESHOLD) {
                drag.dragging = true;
                header.style.cursor = 'grabbing';
            }
            if (drag.dragging) {
                applyPos(root, drag.startLeft + dx, drag.startTop + dy);
            }
        };

        const onUp = () => {
            if (!drag) return;
            const wasDrag = drag.dragging;
            drag = null;
            header.style.cursor = 'grab';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (wasDrag) {
                const rect = root.getBoundingClientRect();
                lsSet({ [LAUNCHER_POS_STORAGE_KEY]: { x: rect.left, y: rect.top } });
            } else {
                toggleExpanded();
            }
        };

        header.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            // Allow children with their own mousedown stopPropagation (e.g. ×
            // close button) to handle their own clicks without starting a
            // drag. Mousedowns that bubble here start the drag.
            e.preventDefault();
            const rect = root.getBoundingClientRect();
            drag = {
                startX: e.clientX,
                startY: e.clientY,
                startLeft: rect.left,
                startTop: rect.top,
                moved: 0,
                dragging: false
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });
    };

    // ----- Expand / collapse -----
    const toggleExpanded = () => {
        if (expanded) collapse();
        else expand();
    };

    const expand = () => {
        if (expanded) return;
        const root = document.getElementById(LAUNCHER_ID);
        if (!root) return;
        const body = document.getElementById('karabast-replays-launcher-body');
        const closeBtn = document.getElementById('karabast-replays-launcher-close');
        if (!body) return;

        // Pre-expand: clear body, populate with current mode's content.
        const active = isRecordingActive();
        mode = active ? 'recording' : 'idle';
        body.replaceChildren(...(active ? buildRecordingBody() : buildIdleBody()));
        body.style.display = 'flex';
        if (closeBtn) closeBtn.style.display = 'inline-block';

        // Width snaps to EXPANDED_WIDTH; the CSS transition on width
        // animates the change for the eye even though the body fades in.
        root.style.width = EXPANDED_WIDTH + 'px';

        // After layout settles, fade in the body and edge-shift if needed.
        requestAnimationFrame(() => {
            body.style.opacity = '1';
            shiftToFit(root);
        });

        expanded = true;
        refreshFooter();

        // Outside-mousedown collapses. Defer attachment by a frame so the
        // click that opened us doesn't immediately close us.
        outsideMousedownHandler = (e) => {
            if (root.contains(e.target)) return;
            collapse();
        };
        setTimeout(() => {
            window.addEventListener('mousedown', outsideMousedownHandler, true);
        }, 0);
    };

    const collapse = () => {
        if (!expanded) return;
        const root = document.getElementById(LAUNCHER_ID);
        const body = document.getElementById('karabast-replays-launcher-body');
        const closeBtn = document.getElementById('karabast-replays-launcher-close');
        if (body) {
            body.style.opacity = '0';
            body.style.display = 'none';
            body.replaceChildren();
        }
        if (closeBtn) closeBtn.style.display = 'none';
        if (root) root.style.width = '';
        expanded = false;
        mode = null;
        if (outsideMousedownHandler) {
            window.removeEventListener('mousedown', outsideMousedownHandler, true);
            outsideMousedownHandler = null;
        }
    };

    // After expanding, if the launcher's bounding rect overflows the viewport,
    // shift its top-left to fit. Not persisted (drag is the only path that
    // updates the stored position).
    const shiftToFit = (root) => {
        const rect = root.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left = rect.left;
        let top = rect.top;
        if (rect.right > vw - VIEWPORT_PADDING) {
            left = Math.max(VIEWPORT_PADDING, vw - rect.width - VIEWPORT_PADDING);
        }
        if (rect.bottom > vh - VIEWPORT_PADDING) {
            top = Math.max(VIEWPORT_PADDING, vh - rect.height - VIEWPORT_PADDING);
        }
        if (left !== rect.left || top !== rect.top) {
            root.style.left = left + 'px';
            root.style.top = top + 'px';
        }
    };

    // ----- Body content builders -----
    // B80: tiny opt-out control for the karabast-drift beacon. LED + label, no
    // native input (matches the bubble's aesthetic). Default = participating;
    // tap to opt out. Reads/writes the same key the SW gates on.
    const buildHealthOptOut = () => {
        const row = document.createElement('button');
        row.type = 'button';
        row.setAttribute('style', [
            'display: inline-flex', 'align-items: center', 'gap: 6px', 'align-self: flex-start',
            'background: transparent', 'border: 0', 'padding: 4px 0', 'cursor: pointer',
            'font: 500 10px -apple-system, BlinkMacSystemFont, sans-serif', 'color: #6c7588', 'text-align: left',
        ].join(';'));
        let optedOut = false;
        const render = () => {
            row.innerHTML = '';
            const dot = document.createElement('span');
            dot.setAttribute('style', 'flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; display: inline-block; ' + (optedOut ? 'background: #5a6473;' : 'background: #6bd968; box-shadow: 0 0 4px #6bd968;'));
            const lbl = document.createElement('span');
            lbl.textContent = optedOut
                ? 'Breakage detection off — tap to help spot karabast changes'
                : 'Anonymous breakage detection on — tap to opt out';
            row.appendChild(dot);
            row.appendChild(lbl);
        };
        render();
        lsGet([HEALTH_OPTOUT_KEY]).then((res) => { optedOut = !!res[HEALTH_OPTOUT_KEY]; render(); });
        row.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            optedOut = !optedOut;
            lsSet({ [HEALTH_OPTOUT_KEY]: optedOut });
            render();
        });
        return row;
    };

    const buildIdleBody = () => {
        const els = [];

        const hint = document.createElement('div');
        hint.setAttribute('style', 'font-size: 11px; color: #6c7588; line-height: 1.4; padding-top: 10px;');
        hint.textContent = 'Recording is automatic — start a match on karabast.net and the launcher will light up.';
        els.push(hint);

        const linksWrap = document.createElement('div');
        linksWrap.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px;');
        linksWrap.appendChild(makeLinkButton('My replays →', 'primary', () => {
            B().openReplays('mine').catch(() => {});
            collapse();
        }));
        els.push(linksWrap);

        els.push(buildShareSection());
        // B170: local recordings not yet uploaded (e.g. a private game withheld
        // because the key wasn't loaded). Sits BELOW the share section so the
        // team is armed above before uploading. The payloads never reached the
        // server, so uploading them encrypted is safe.
        els.push(buildPendingUploadsSection());
        els.push(buildWhoamiBlock());
        els.push(buildHealthOptOut());

        return els;
    };

    // B170 / ADR 0010 — "Pending uploads": recordings held only in this browser
    // (no karabuddySlug — withheld private games, or failed/never-sent uploads).
    // Their plaintext never reached the server, so uploading now is safe: the SW
    // encrypts if a private team is armed + its key is loaded, else uploads
    // plaintext to the armed open teams (same path as a fresh recording).
    const matchupLabel = (players) => {
        try {
            const names = (players || []).map((p) => (p.leader && p.leader.name) || p.username || '?');
            if (names.length >= 2) return `${names[0]} vs ${names[1]}`;
            if (names.length === 1) return names[0];
        } catch {}
        return 'Recorded game';
    };
    const agoLabel = (ts) => {
        const s = Math.max(0, Math.floor((Date.now() - (ts || 0)) / 1000));
        if (s < 60) return 'just now';
        const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
    };

    const uploadPending = async (entry, btn) => {
        btn.disabled = true; btn.textContent = 'Uploading…';
        try {
            const r = await B().getReplay(entry.gameId);
            if (!r || !r.payload) { T()?.show?.('Recording not found on this device', { kind: 'error' }); btn.disabled = false; btn.textContent = 'Upload'; return; }
            let obj = null; try { obj = JSON.parse(r.payload); } catch {}
            const summary = obj ? (D()?.buildEncryptedSummary?.(obj, obj.localPlayerId || null) || null) : null;
            const result = await B().uploadReplay(r.payload, summary);
            if (result && result.withheld) {
                // Still can't encrypt — guide the user to arm the team + load the key.
                const msg = result.reason === 'no-key'
                    ? 'Load this team’s key (Manage keys), then upload'
                    : result.reason === 'key-conflict'
                    ? 'Arm just one private team, then upload'
                    : 'Arm the private team above and load its key, then upload';
                T()?.show?.(msg, { kind: 'warning' });
                btn.disabled = false; btn.textContent = 'Upload';
                return;
            }
            if (!result || !result.slug) { T()?.show?.('Upload failed', { kind: 'error' }); btn.disabled = false; btn.textContent = 'Upload'; return; }
            // Patch the local entry with the hosted slug so it leaves the list.
            await B().saveReplay({ ...r, karabuddySlug: result.slug, karabuddyUrl: result.url });
            // Apply the armed team-share rows (plaintext path; encrypted uploads
            // already carried their shares server-side).
            const slugs = getShareTeamSlugs();
            if (!result.encrypted && slugs.length) B().applyTeamShares?.(result.slug, slugs);
            T()?.show?.(result.encrypted ? 'Uploaded (encrypted) ✓' : 'Uploaded ✓', { kind: 'success' });
            refreshPendingUploads();
        } catch (err) {
            T()?.show?.('Upload failed', { kind: 'error' });
            btn.disabled = false; btn.textContent = 'Upload';
        }
    };

    const renderPendingInto = (section, pending) => {
        section.innerHTML = '';
        if (!pending.length) { section.style.display = 'none'; return; }
        section.style.display = 'flex';
        const label = document.createElement('div');
        label.setAttribute('style', 'font: 600 10px -apple-system, BlinkMacSystemFont, sans-serif; color: #6c7588; letter-spacing: 0.08em; text-transform: uppercase;');
        label.textContent = 'Not yet uploaded';
        section.appendChild(label);
        for (const e of pending.slice(0, 5)) {
            const row = document.createElement('div');
            row.setAttribute('style', 'display: flex; align-items: center; gap: 8px; padding: 4px 0;');
            const txt = document.createElement('div');
            txt.setAttribute('style', 'flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;');
            const name = document.createElement('div');
            name.setAttribute('style', 'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif; color: #d6e7ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;');
            name.textContent = matchupLabel(e.players);
            const sub = document.createElement('div');
            sub.setAttribute('style', 'font-size: 10px; color: #6c7588;');
            sub.textContent = agoLabel(e.savedAt);
            txt.appendChild(name); txt.appendChild(sub);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'Upload';
            btn.setAttribute('style', 'flex: 0 0 auto; background: rgba(77,157,255,0.18); color: #d6e7ff; border: 1px solid #4d9dff; border-radius: 6px; padding: 5px 11px; font: 600 11px -apple-system, BlinkMacSystemFont, sans-serif; cursor: pointer;');
            btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
            btn.addEventListener('click', (ev) => { ev.stopPropagation(); uploadPending(e, btn); });
            row.appendChild(txt); row.appendChild(btn);
            section.appendChild(row);
        }
    };

    const refreshPendingUploads = () => {
        const section = document.getElementById('karabast-replays-panel-pending');
        if (!section) return;
        B().listReplays().then((list) => {
            const pending = (Array.isArray(list) ? list : []).filter((e) => !e.karabuddySlug);
            renderPendingInto(section, pending);
        }).catch(() => {});
    };

    const buildPendingUploadsSection = () => {
        const section = document.createElement('div');
        section.id = 'karabast-replays-panel-pending';
        section.setAttribute('style', 'display: none; flex-direction: column; gap: 4px;');
        // Populate async via the local ref (the section isn't in the DOM yet, so
        // a getElementById lookup would miss it). Hidden until there's something.
        B().listReplays().then((list) => {
            const pending = (Array.isArray(list) ? list : []).filter((e) => !e.karabuddySlug);
            renderPendingInto(section, pending);
        }).catch(() => {});
        return section;
    };

    const buildRecordingBody = () => {
        const els = [];

        // REC sub-header inside the body (the launcher's own header already
        // shows the small REC indicator; the body restates it as a label
        // with the "events" suffix so the count is obvious at a glance).
        const recBlock = document.createElement('div');
        recBlock.setAttribute('style', 'display: flex; align-items: center; gap: 8px; padding-top: 10px;');
        const recDot = document.createElement('span');
        recDot.setAttribute('style', 'display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #ff4040; box-shadow: 0 0 6px #ff4040; animation: karabast-rec-pulse 1.4s ease-in-out infinite; flex: 0 0 auto;');
        const recLabel = document.createElement('span');
        recLabel.id = 'karabast-replays-panel-rec-label';
        recLabel.setAttribute('style', 'font: 700 13px -apple-system, BlinkMacSystemFont, sans-serif; color: #fff; letter-spacing: 0.04em;');
        recLabel.textContent = 'REC';
        recBlock.appendChild(recDot);
        recBlock.appendChild(recLabel);
        els.push(recBlock);

        const hint = document.createElement('div');
        hint.setAttribute('style', 'font-size: 11px; color: #6c7588; line-height: 1.4;');
        hint.textContent = 'Saves automatically and uploads to karabuddy when the game ends.';
        els.push(hint);

        els.push(buildTagBlock());

        const recentSection = document.createElement('div');
        recentSection.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px;');
        const recentLabel = document.createElement('div');
        recentLabel.setAttribute('style', 'font: 600 10px -apple-system, BlinkMacSystemFont, sans-serif; color: #6c7588; letter-spacing: 0.08em; text-transform: uppercase;');
        recentLabel.textContent = 'Recent tags';
        const recentList = document.createElement('div');
        recentList.id = 'karabast-replays-panel-recent-list';
        recentList.setAttribute('style', 'display: flex; flex-direction: column; gap: 4px;');
        recentSection.appendChild(recentLabel);
        recentSection.appendChild(recentList);
        els.push(recentSection);

        els.push(buildShareSection());
        els.push(buildWhoamiBlock());

        const openLink = document.createElement('a');
        openLink.id = 'karabast-replays-panel-open-link';
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        openLink.textContent = 'Open this replay on karabuddy →';
        openLink.setAttribute('style', [
            'display: none',
            'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'color: #5db4ff',
            'text-decoration: none',
            'padding: 6px 0 0',
            'border-top: 1px solid #2e333c'
        ].join(';'));
        // Anchor clicks shouldn't initiate drag.
        openLink.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        els.push(openLink);

        return els;
    };

    // Idle-mode link button.
    const makeLinkButton = (text, variant, onClick) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = text;
        const base = variant === 'primary'
            ? ['background: rgba(77, 157, 255, 0.18)', 'color: #d6e7ff', 'border: 1px solid #4d9dff']
            : ['background: transparent', 'color: #d6e7ff', 'border: 1px solid #2e333c'];
        btn.setAttribute('style', base.concat([
            'border-radius: 6px',
            'padding: 9px 12px',
            'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'cursor: pointer',
            'text-align: left'
        ]).join(';'));
        btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return btn;
    };

    // B55c: cached mention autocomplete data. Loaded on first tag-form
    // open via the bridge → service worker → karabuddy.app fetch. 5-min
    // TTL — stale enough that user roster changes propagate, fresh
    // enough that we don't hammer the API on every tag attempt.
    let mentionDataCache = null;
    let mentionDataLoadedAt = 0;
    const MENTION_TTL_MS = 5 * 60 * 1000;
    // Returns:
    //   { teams: [...], members: [...] }  on successful auth (even if both are empty)
    //   null                              on auth failure / network failure
    // The shape difference matters for the share-teams panel — "401"
    // and "signed-in but in 0 teams" need different copy.
    const loadMentionData = async (force = false) => {
        if (!force && mentionDataCache && Date.now() - mentionDataLoadedAt < MENTION_TTL_MS) {
            return mentionDataCache;
        }
        try {
            const result = await B().getTeamsMentionData?.();
            if (result && result.ok) {
                mentionDataCache = { teams: result.teams || [], members: result.members || [] };
                mentionDataLoadedAt = Date.now();
                return mentionDataCache;
            }
        } catch {}
        return null;
    };

    // Detect `@<prefix>` immediately before the cursor (no whitespace
    // between @ and cursor). Returns the prefix string after `@`, or
    // null. Mirrors the web MentionInput.tsx logic.
    const detectMentionContext = (text, cursor) => {
        let i = cursor - 1;
        while (i >= 0) {
            const ch = text[i];
            if (ch === '@') {
                if (i === 0 || /\s/.test(text[i - 1])) {
                    return text.slice(i + 1, cursor);
                }
                return null;
            }
            if (/\s/.test(ch)) return null;
            i--;
        }
        return null;
    };

    const buildMentionSuggestions = (data, prefix) => {
        const p = prefix.toLowerCase();
        if (p.startsWith('team:')) {
            const teamPrefix = p.slice(5);
            return (data.teams || [])
                .filter((t) => t.name.toLowerCase().startsWith(teamPrefix) || t.slug.toLowerCase().startsWith(teamPrefix))
                .map((t) => ({ kind: 'team', slug: t.slug, name: t.name }))
                .slice(0, 6);
        }
        const members = (data.members || [])
            .filter((m) => m.handle.toLowerCase().startsWith(p) || (m.displayName || '').toLowerCase().startsWith(p))
            .map((m) => ({ kind: 'user', userId: m.userId, handle: m.handle, displayName: m.displayName }));
        const teams = (data.teams || [])
            .filter((t) => t.name.toLowerCase().startsWith(p) || t.slug.toLowerCase().startsWith(p))
            .map((t) => ({ kind: 'team', slug: t.slug, name: t.name }));
        return [...members, ...teams].slice(0, 6);
    };

    // Compact tag block: button toggles a textarea + Save/Cancel inline.
    const buildTagBlock = () => {
        const wrap = document.createElement('div');
        wrap.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px;');

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = '+ Tag this moment';
        addBtn.setAttribute('style', [
            'background: rgba(77, 157, 255, 0.18)',
            'color: #d6e7ff',
            'border: 1px solid #4d9dff',
            'border-radius: 6px',
            'padding: 10px 14px',
            'font: 600 13px -apple-system, BlinkMacSystemFont, sans-serif',
            'cursor: pointer',
            'align-self: stretch'
        ].join(';'));

        const form = document.createElement('div');
        form.setAttribute('style', [
            'display: none',
            'flex-direction: column',
            'gap: 6px',
            'padding: 8px',
            'background: rgba(77, 157, 255, 0.08)',
            'border: 1px solid rgba(77, 157, 255, 0.3)',
            'border-radius: 6px'
        ].join(';'));

        // B55c: relative wrapper so the autocomplete popover can anchor
        // below the textarea.
        const textareaWrap = document.createElement('div');
        textareaWrap.setAttribute('style', 'position: relative; display: flex; flex-direction: column;');

        const input = document.createElement('textarea');
        input.placeholder = 'Optional comment for this moment… @mention to notify';
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
        // Stop mousedown on input so textarea-drag-selection doesn't start a
        // launcher drag through the header handler.
        input.addEventListener('mousedown', (e) => { e.stopPropagation(); });

        // B55c: structured mentions for the in-progress tag draft. Reset
        // on form open/close. Picked from the autocomplete popover; bare
        // typed `@word` without selecting is just text and won't notify.
        let formMentions = { userIds: [], teamSlugs: [] };
        const addMention = (kind, id) => {
            if (kind === 'user') {
                if (!formMentions.userIds.includes(id)) formMentions.userIds.push(id);
            } else if (kind === 'team') {
                if (!formMentions.teamSlugs.includes(id)) formMentions.teamSlugs.push(id);
            }
            // B73: a new @-mention may narrow the audience — refresh the chip.
            refreshScopeReadout();
        };

        // B73: the comment's team audience, via the SHARED scopeFromMentions
        // rule (00-comment-scope.js — same file the web app imports). Default
        // = all armed teams; @-mentioning people narrows to the union of
        // their teams (∩ armed). Returns null when nothing is armed (server
        // defaults to the replay's shares, which is also empty → personal).
        const computeTagScope = () => {
            const armed = getShareTeamSlugs();
            if (armed.length === 0) return null;
            const memberTeams = {};
            for (const m of (mentionDataCache && mentionDataCache.members) || []) {
                memberTeams[m.userId] = m.teamSlugs || [];
            }
            return scopeFromMentions({ armedTeams: armed, mentionedUserIds: formMentions.userIds, memberTeams });
        };

        // B75: per-comment scope override. null = follow the mention-driven
        // rule above; an array = an explicit choice from the chip checkboxes
        // (wins until reset, always clamped to the armed set). Reset each time
        // the form opens/closes. Mirrors the web viewer's ScopeChip.
        let scopeOverride = null;
        let scopeExpanded = false;
        const resetScope = () => { scopeOverride = null; scopeExpanded = false; };
        // Effective audience: the override (clamped to armed) if set, else the
        // mention-driven scope. [] = personal.
        const effectiveScopeArr = () => {
            const armed = getShareTeamSlugs();
            if (armed.length === 0) return [];
            if (scopeOverride !== null) return scopeOverride.filter((s) => armed.includes(s));
            return computeTagScope() || [];
        };
        // What we send to addTag: null when nothing is armed (server defaults
        // to the replay's shares — empty → personal), else the chosen audience.
        const scopeToSave = () => (getShareTeamSlugs().length === 0 ? null : effectiveScopeArr());
        // Chip handlers — seed from the current effective scope so the first
        // click turns the live rule into an explicit set, then toggle.
        const toggleTeam = (slug) => {
            const cur = effectiveScopeArr();
            scopeOverride = cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug];
            refreshScopeReadout();
        };
        const setPersonalScope = () => { scopeOverride = []; refreshScopeReadout(); };

        // B73/B75: clickable "Visible to: …" chip. Collapsed = the audience
        // readout; click to expand per-team checkboxes + a "Just me" option so
        // a comment can be scoped to a subset of the armed teams directly (not
        // only via @-mentions). Mirrors the web viewer's ScopeChip.
        const scopeReadout = document.createElement('div');
        scopeReadout.setAttribute('style', 'display: flex; flex-direction: column; gap: 6px; align-self: flex-start;');
        const scopeToggle = document.createElement('button');
        scopeToggle.type = 'button';
        scopeToggle.setAttribute('style', [
            'display: inline-flex',
            'align-items: center',
            'gap: 6px',
            'align-self: flex-start',
            'background: rgba(77, 157, 255, 0.08)',
            'border: 1px solid rgba(77, 157, 255, 0.3)',
            'color: #a7d2ff',
            'border-radius: 999px',
            'padding: 3px 10px',
            'font: 600 11px -apple-system, BlinkMacSystemFont, sans-serif',
            'cursor: pointer'
        ].join(';'));
        scopeToggle.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        scopeToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (getShareTeamSlugs().length === 0) return; // nothing to choose
            scopeExpanded = !scopeExpanded;
            refreshScopeReadout();
        });
        const scopePanel = document.createElement('div');
        scopePanel.setAttribute('style', [
            'display: none',
            'flex-direction: column',
            'gap: 4px',
            'padding: 6px 8px',
            'background: #11141a',
            'border: 1px solid #2e333c',
            'border-radius: 6px'
        ].join(';'));
        scopePanel.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        scopeReadout.appendChild(scopeToggle);
        scopeReadout.appendChild(scopePanel);
        // B75: a scope row reuses the "Share with teams" LED idiom (status LED
        // + monospace name + uppercase status), not a native checkbox/radio, so
        // the panel reads as the same cockpit control as the rest of the bubble.
        const buildScopeRow = (name, lit, statusText, onClick) => {
            const accent = lit ? '#4dd2ff' : '#3a4150';
            const row = document.createElement('div');
            row.setAttribute('role', 'button');
            row.setAttribute('tabindex', '0');
            row.setAttribute('aria-pressed', lit ? 'true' : 'false');
            row.setAttribute('style', [
                'display: flex',
                'align-items: center',
                'gap: 9px',
                'padding: 5px 8px',
                'border-radius: 4px',
                'background: ' + (lit ? 'rgba(77, 210, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)'),
                'border-left: 2px solid ' + accent,
                'cursor: pointer',
                'transition: background 120ms ease, border-color 120ms ease'
            ].join(';'));
            row.addEventListener('mousedown', (e) => { e.stopPropagation(); });
            row.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
            row.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
            });
            const led = document.createElement('span');
            led.setAttribute('style', [
                'display: inline-flex',
                'align-items: center',
                'justify-content: center',
                'width: 12px',
                'height: 12px',
                'border-radius: 50%',
                'border: 1.5px solid ' + accent,
                'background: rgba(0, 0, 0, 0.45)',
                'box-shadow: ' + (lit ? '0 0 6px rgba(77, 210, 255, 0.7), inset 0 0 4px rgba(77, 210, 255, 0.45)' : 'inset 0 0 2px rgba(0,0,0,0.6)'),
                'flex: 0 0 auto'
            ].join(';'));
            if (lit) {
                const dot = document.createElement('span');
                dot.setAttribute('style', 'display: block; width: 5px; height: 5px; border-radius: 50%; background: #4dd2ff; box-shadow: 0 0 4px #4dd2ff;');
                led.appendChild(dot);
            }
            const nm = document.createElement('span');
            nm.setAttribute('style', [
                'flex: 1 1 auto',
                'min-width: 0',
                'overflow: hidden',
                'text-overflow: ellipsis',
                'white-space: nowrap',
                'font: 600 12px "SF Mono", Menlo, Consolas, monospace',
                'color: ' + (lit ? '#d6f0ff' : '#a8b0bd'),
                'letter-spacing: 0.02em'
            ].join(';'));
            nm.textContent = name;
            row.appendChild(led);
            row.appendChild(nm);
            if (lit && statusText) {
                const status = document.createElement('span');
                status.setAttribute('style', 'font: 700 9px "SF Mono", Menlo, Consolas, monospace; color: #4dd2ff; letter-spacing: 0.18em; text-transform: uppercase; flex: 0 0 auto;');
                status.textContent = statusText;
                row.appendChild(status);
            }
            return row;
        };
        const refreshScopeReadout = () => {
            const armed = getShareTeamSlugs();
            const teamNames = {};
            for (const t of (mentionDataCache && mentionDataCache.teams) || []) teamNames[t.slug] = t.name;
            const eff = effectiveScopeArr();
            if (armed.length === 0) scopeExpanded = false;

            // Collapsed pill: "Visible to: <label>" + caret when expandable.
            scopeToggle.innerHTML = '';
            const lead = document.createElement('span');
            lead.setAttribute('style', 'color: #6c7588;');
            lead.textContent = 'Visible to:';
            const lbl = document.createElement('span');
            lbl.textContent = armed.length === 0 ? 'just you (personal)' : scopeLabel(eff, armed, teamNames);
            scopeToggle.appendChild(lead);
            scopeToggle.appendChild(lbl);
            if (armed.length > 0) {
                const caret = document.createElement('span');
                caret.setAttribute('style', 'font-size: 9px;');
                caret.textContent = scopeExpanded ? '▴' : '▾';
                scopeToggle.appendChild(caret);
                scopeToggle.style.cursor = 'pointer';
            } else {
                scopeToggle.style.cursor = 'default';
            }

            // Expanded panel: LED rows (no native inputs) — one per armed team
            // + a "Just me" row, matching the Share-with-teams control idiom.
            scopePanel.innerHTML = '';
            if (armed.length > 0 && scopeExpanded) {
                scopePanel.style.display = 'flex';
                for (const slug of armed) {
                    scopePanel.appendChild(
                        buildScopeRow(teamNames[slug] || slug, eff.includes(slug), 'Included', () => toggleTeam(slug)),
                    );
                }
                const divider = document.createElement('div');
                divider.setAttribute('style', 'height: 1px; background: #2e333c; margin: 2px 0;');
                scopePanel.appendChild(divider);
                scopePanel.appendChild(
                    buildScopeRow('Just me (personal)', eff.length === 0, 'Only me', setPersonalScope),
                );
            } else {
                scopePanel.style.display = 'none';
            }
        };

        // Autocomplete popover element (built lazily on first @-detect).
        let popover = null;
        let popoverActiveIndex = 0;
        let popoverSuggestions = [];

        const closePopover = () => {
            if (popover) {
                popover.remove();
                popover = null;
            }
            popoverSuggestions = [];
            popoverActiveIndex = 0;
        };

        const renderPopover = (suggestions) => {
            if (!popover) {
                popover = document.createElement('div');
                popover.setAttribute('style', [
                    'position: absolute',
                    'top: 100%',
                    'left: 0',
                    'right: 0',
                    'margin-top: 4px',
                    'background: rgba(17, 20, 26, 0.98)',
                    'border: 1px solid rgba(77, 157, 255, 0.4)',
                    'border-radius: 6px',
                    'padding: 4px',
                    'z-index: 50',
                    'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5)',
                    'max-height: 240px',
                    'overflow-y: auto'
                ].join(';'));
                popover.addEventListener('mousedown', (e) => { e.stopPropagation(); });
                textareaWrap.appendChild(popover);
            }
            popoverSuggestions = suggestions;
            popover.innerHTML = '';
            suggestions.forEach((s, i) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                const isActive = i === popoverActiveIndex;
                btn.setAttribute('style', [
                    'display: flex',
                    'align-items: center',
                    'gap: 8px',
                    'width: 100%',
                    'padding: 6px 8px',
                    'background: ' + (isActive ? 'rgba(77, 157, 255, 0.18)' : 'transparent'),
                    'border: 0',
                    'border-radius: 4px',
                    'color: #e6e6e6',
                    'font: 12px -apple-system, BlinkMacSystemFont, sans-serif',
                    'cursor: pointer',
                    'text-align: left'
                ].join(';'));
                if (s.kind === 'user') {
                    const handle = document.createElement('span');
                    handle.setAttribute('style', 'color: #5db4ff; font-weight: 600;');
                    handle.textContent = '@' + s.handle;
                    btn.appendChild(handle);
                    if (s.displayName && s.displayName !== s.handle) {
                        const sub = document.createElement('span');
                        sub.setAttribute('style', 'color: #6c7588; font-size: 11px;');
                        sub.textContent = s.displayName;
                        btn.appendChild(sub);
                    }
                } else {
                    const badge = document.createElement('span');
                    badge.setAttribute('style', [
                        'display: inline-flex',
                        'align-items: center',
                        'justify-content: center',
                        'width: 18px',
                        'height: 18px',
                        'border-radius: 4px',
                        'background: rgba(107, 217, 104, 0.15)',
                        'color: #6bd968',
                        'font: 700 9px -apple-system, sans-serif'
                    ].join(';'));
                    badge.textContent = 'T';
                    btn.appendChild(badge);
                    const handle = document.createElement('span');
                    handle.setAttribute('style', 'color: #6bd968; font-weight: 600;');
                    handle.textContent = '@team:' + s.slug;
                    btn.appendChild(handle);
                    const sub = document.createElement('span');
                    sub.setAttribute('style', 'color: #6c7588; font-size: 11px;');
                    sub.textContent = s.name;
                    btn.appendChild(sub);
                }
                btn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    insertSuggestion(s);
                });
                btn.addEventListener('mouseenter', () => {
                    popoverActiveIndex = i;
                    renderPopover(suggestions);
                });
                popover.appendChild(btn);
            });
        };

        const insertSuggestion = (sugg) => {
            const cursor = input.selectionStart || 0;
            const text = input.value;
            let atIndex = -1;
            for (let i = cursor - 1; i >= 0; i--) {
                if (text[i] === '@') { atIndex = i; break; }
                if (/\s/.test(text[i])) break;
            }
            if (atIndex === -1) return;
            const insertText = sugg.kind === 'user' ? '@' + sugg.handle + ' ' : '@team:' + sugg.slug + ' ';
            const next = text.slice(0, atIndex) + insertText + text.slice(cursor);
            input.value = next;
            const pos = atIndex + insertText.length;
            input.setSelectionRange(pos, pos);
            input.focus();
            if (sugg.kind === 'user') addMention('user', sugg.userId);
            else addMention('team', sugg.slug);
            closePopover();
        };

        const recomputePopover = async () => {
            const text = input.value;
            const cursor = input.selectionStart || 0;
            const ctx = detectMentionContext(text, cursor);
            if (ctx === null) {
                closePopover();
                return;
            }
            const data = await loadMentionData();
            if (!data) {
                closePopover();
                return;
            }
            const suggestions = buildMentionSuggestions(data, ctx);
            if (suggestions.length === 0) {
                closePopover();
                return;
            }
            if (popoverActiveIndex >= suggestions.length) popoverActiveIndex = 0;
            renderPopover(suggestions);
        };

        const openForm = () => {
            form.style.display = 'flex';
            input.value = '';
            formMentions = { userIds: [], teamSlugs: [] };
            resetScope();
            // Kick off mention data fetch in parallel with form open —
            // it'll be cached by the time the user types `@`. B73: refresh
            // the scope readout once team names are available too.
            refreshScopeReadout();
            loadMentionData().then(refreshScopeReadout);
            setTimeout(() => input.focus(), 0);
        };
        const closeForm = () => {
            form.style.display = 'none';
            closePopover();
            formMentions = { userIds: [], teamSlugs: [] };
            resetScope();
        };

        addBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (form.style.display === 'none' || !form.style.display) openForm();
            else closeForm();
        });

        input.addEventListener('keydown', (e) => {
            // B55c: popover-active keyboard nav takes precedence.
            if (popover) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    popoverActiveIndex = (popoverActiveIndex + 1) % popoverSuggestions.length;
                    renderPopover(popoverSuggestions);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    popoverActiveIndex = (popoverActiveIndex - 1 + popoverSuggestions.length) % popoverSuggestions.length;
                    renderPopover(popoverSuggestions);
                    return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    if (popoverSuggestions[popoverActiveIndex]) insertSuggestion(popoverSuggestions[popoverActiveIndex]);
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closePopover();
                    return;
                }
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                R().addTag(input.value.trim(), formMentions, scopeToSave());
                closeForm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeForm();
            }
        });
        // B55c: re-check mention context on any keyup (covers arrow-key
        // cursor movement and printable typing alike).
        input.addEventListener('input', () => { recomputePopover(); });
        input.addEventListener('keyup', (e) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
                recomputePopover();
            }
        });
        input.addEventListener('click', () => { recomputePopover(); });

        const btnRow = document.createElement('div');
        btnRow.setAttribute('style', 'display: flex; gap: 6px; align-self: flex-end;');
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.setAttribute('style', [
            'background: transparent',
            'color: #a0a8b8',
            'border: 1px solid #4a4e56',
            'border-radius: 4px',
            'padding: 3px 8px',
            'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'cursor: pointer'
        ].join(';'));
        cancelBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeForm();
        });
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.textContent = 'Save tag';
        saveBtn.setAttribute('style', [
            'background: #4d9dff',
            'color: #fff',
            'border: 0',
            'border-radius: 4px',
            'padding: 3px 8px',
            'font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif',
            'cursor: pointer'
        ].join(';'));
        saveBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            R().addTag(input.value.trim(), formMentions, scopeToSave());
            closeForm();
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        textareaWrap.appendChild(input);
        form.appendChild(textareaWrap);
        form.appendChild(scopeReadout); // B73: "Visible to: …" between textarea and buttons
        form.appendChild(btnRow);

        wrap.appendChild(addBtn);
        wrap.appendChild(form);
        return wrap;
    };

    // Repaint the recent-tags list — most recent first, limited to 5.
    const renderRecentTags = (listEl) => {
        if (!listEl) return;
        listEl.innerHTML = '';
        const tags = R().getTags();
        if (!tags || tags.length === 0) {
            const empty = document.createElement('div');
            empty.setAttribute('style', 'font-size: 11px; color: #6c7588; font-style: italic; padding: 2px 0;');
            empty.textContent = 'No tags yet.';
            listEl.appendChild(empty);
            return;
        }
        const playerUsernames = R().getPlayerUsernames();
        const sorted = [...tags]
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, RECENT_TAGS_MAX);
        for (const tag of sorted) {
            const row = document.createElement('div');
            const color = D().playerColorFor(tag.author, playerUsernames);
            row.setAttribute('style', [
                'display: flex',
                'flex-direction: column',
                'gap: 2px',
                'padding: 5px 7px',
                'border-radius: 4px',
                'background: rgba(255, 255, 255, 0.025)',
                'border-left: 3px solid ' + color
            ].join(';'));

            const head = document.createElement('div');
            head.setAttribute('style', 'display: flex; align-items: center; gap: 8px; font-size: 10px; color: #a0a8b8;');
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

            const comment = document.createElement('div');
            comment.setAttribute('style', 'font-size: 11px; color: #d6d6d6; line-height: 1.3; word-wrap: break-word; white-space: pre-wrap;');
            comment.textContent = tag.comment || '(no comment)';
            if (!tag.comment) comment.style.color = '#6c7588';

            row.appendChild(head);
            row.appendChild(comment);
            listEl.appendChild(row);
        }
    };

    // ----- Mount + state-aware refresh -----
    const installFooter = () => {
        if (!document.body) return;
        if (document.getElementById(LAUNCHER_ID)) return;
        document.body.appendChild(buildLauncher());
        loadShareState();
        refreshFooter();
    };

    // B170 / ADR 0010: the unified SHARE-STATUS chip — icon + team count derived
    // from the actual upload decision (privacyStatus). Visible whenever ≥1 team is
    // armed, collapsed OR expanded, recording or not (the selection is
    // persistent). ● N = sharing (open) · 🔒 N = encrypting (private + key) ·
    // ⚠ N = private team armed without its key (won't upload).
    const updateShareStatus = () => {
        const block = document.getElementById('karabast-replays-launcher-share');
        if (!block) return;
        const label = document.getElementById('karabast-replays-launcher-share-label');
        const ps = privacyStatus;
        const count = ps && Array.isArray(ps.teamNames) ? ps.teamNames.length : 0;
        if (!ps || count === 0) { block.style.display = 'none'; return; }
        block.style.display = 'inline-flex';
        let icon, color, title;
        if (ps.mode === 'withhold') {
            icon = '⚠'; color = '#ffb020';
            title = ps.reason === 'key-conflict'
                ? 'Two private teams with different keys are armed — arm just one. Won’t upload. Click to manage.'
                : `${count} private team${count === 1 ? '' : 's'} armed without a key — won’t upload until you load it. Click to manage.`;
        } else if (ps.mode === 'encrypt') {
            icon = '🔒'; color = '#9fe6ff';
            title = `Encrypting for ${count} private team${count === 1 ? '' : 's'} — KaraBuddy can’t read it. Click to manage.`;
        } else {
            icon = '●'; color = '#6bd968';
            title = `Sharing with ${count} team${count === 1 ? '' : 's'}. Click to manage.`;
        }
        if (label) { label.textContent = `${icon} ${count}`; label.style.color = color; }
        block.title = title;
    };

    // Fetch the privacy decision from the SW (decideUploadMode — single source of
    // truth) and repaint the chip. In-flight guard so a burst of refreshFooter
    // ticks can't fan out duplicate fetches.
    let privacyFetchInFlight = false;
    const refreshPrivacyStatus = async () => {
        if (privacyFetchInFlight) return;
        privacyFetchInFlight = true;
        try { privacyStatus = (await B().getPrivacyStatus?.()) || null; }
        catch { privacyStatus = null; }
        finally { privacyFetchInFlight = false; }
        updateShareStatus();
    };

    const refreshFooter = () => {
        const launcher = document.getElementById(LAUNCHER_ID);
        if (!launcher) return;
        const active = isRecordingActive();

        // REC indicator in the header reveals only while capturing.
        const recBlock = document.getElementById('karabast-replays-launcher-rec');
        if (recBlock) recBlock.style.display = active ? 'flex' : 'none';

        // B170: unified share-status chip — armed-gated (NOT recording-gated) so
        // it shows in the collapsed bubble too. Lazily fetch the decision on first
        // paint (when null); otherwise paint from cache (cheap, DOM-only).
        if (privacyStatus === null) refreshPrivacyStatus();
        updateShareStatus();

        // If the recording state flipped while expanded, the body content
        // (idle links vs recording controls) is now stale. Collapse so the
        // next user open rebuilds in the correct mode — the toast that fired
        // around the transition tells them what just happened.
        if (expanded && mode !== (active ? 'recording' : 'idle')) {
            collapse();
        }

        // Live REC count in the launcher header.
        const countEl = document.getElementById('karabast-replays-launcher-rec-count');
        if (countEl) countEl.textContent = `REC · ${R().getRecordingLength()}`;

        // Repaint body content for the recording mode (idle has no live data).
        if (expanded && mode === 'recording') {
            const recLabel = document.getElementById('karabast-replays-panel-rec-label');
            if (recLabel) recLabel.textContent = `REC · ${R().getRecordingLength()} events`;

            const recentList = document.getElementById('karabast-replays-panel-recent-list');
            renderRecentTags(recentList);

            const openLink = document.getElementById('karabast-replays-panel-open-link');
            if (openLink) {
                const url = R().getCurrentKarabuddyUrl?.();
                if (url) {
                    openLink.href = url;
                    openLink.style.display = 'inline-block';
                } else {
                    openLink.style.display = 'none';
                }
            }
        }
    };

    NS.Footer = {
        installFooterStyles,
        installFrame,
        installFooter,
        refreshFooter,
        refreshOverlay: refreshFooter,
        updateOverlay: refreshFooter,
        isPanelOpen: () => expanded,
        // B67: recorder calls this after every successful upload to
        // know which teams to fan out share rows for.
        getShareTeamSlugs
    };
})();
