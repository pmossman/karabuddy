// B170 / ADR 0010: the extension's trusted, TEAM-CENTRIC key manager (keys.html).
// Runs at a chrome-extension:// origin with direct chrome.storage + the e2ee
// module on window.__KaraBuddy.replays.e2ee. It reconciles the keys loaded on
// this device against YOUR private teams (the server knows each team's current
// key id) so there's one active key per team, auto-named by the real team name —
// no bag of mystery keys. Writes route through the SW's verified handlers; the
// key never leaves the extension.
(() => {
  const e2ee = () => (window.__KaraBuddy && window.__KaraBuddy.replays && window.__KaraBuddy.replays.e2ee) || null;
  const $ = (id) => document.getElementById(id);
  // A freshly generated key's id: on the next render of its team detail we auto-
  // open the normal Show-key reveal once (so the owner sees + copies it right
  // away), then clear it. The key isn't special after that — it stays viewable via
  // Show key like any loaded key, since it lives in this browser on this device.
  let autoRevealKid = null;
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    Object.assign(n, props);
    if (props.style) n.setAttribute('style', props.style);
    for (const k of kids) n.append(k);
    return n;
  };
  const sw = (msg) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage(msg, (res) => resolve(res || { ok: false })); }
    catch { resolve({ ok: false }); }
  });

  // Two-step inline confirm for a hard-to-reverse action (forgetting a key,
  // turning on private mode). Renders a Cancel / confirm prompt into `host`;
  // Cancel clears it, confirming runs `onConfirm`. Most onConfirm callbacks
  // re-render the whole view (which wipes the prompt anyway); we also clear it.
  function askConfirm(host, { message, confirmLabel, danger, onConfirm }) {
    const a = danger
      ? { line: 'rgba(255,120,90,0.55)', bg: 'rgba(255,90,70,0.08)', txt: '#ffb4a0' }
      : { line: 'rgba(255,176,32,0.45)', bg: 'rgba(255,176,32,0.07)', txt: '#ffd98a' };
    const clear = () => { host.innerHTML = ''; host.removeAttribute('style'); };
    host.innerHTML = '';
    host.setAttribute('style', `margin-top:10px; padding:11px 13px; border:1px solid ${a.line}; background:${a.bg}; border-radius:9px;`);
    const yes = el('button', { className: danger ? 'warn' : '', textContent: confirmLabel });
    const no = el('button', { className: 'ghost', textContent: 'Cancel' });
    no.onclick = clear;
    yes.onclick = async () => { yes.disabled = true; no.disabled = true; try { await onConfirm(); } finally { clear(); } };
    host.append(
      el('div', { style: `font-size:12px; color:${a.txt}; line-height:1.5; margin-bottom:9px`, textContent: message }),
      el('div', { className: 'gap' }, yes, no),
    );
  }

  // Local label store (so the PrivateModeToggle picker + offline view can show a
  // name). We set it to the real team name when a key matches a team.
  const LABELS_KEY = 'karabuddyPrivateKeyLabels';
  const getLabels = async () => { try { return (await chrome.storage.local.get(LABELS_KEY))[LABELS_KEY] || {}; } catch { return {}; } };
  const setLabel = async (kid, name) => {
    const labels = await getLabels();
    if (name && name.trim()) labels[kid] = name.trim().slice(0, 60); else delete labels[kid];
    try { await chrome.storage.local.set({ [LABELS_KEY]: labels }); } catch {}
  };

  // In-progress rotations: teamSlug → the NEW key's kid. Lets the manager show a
  // second "new key (rotating)" per team and resume, until the rotation lands.
  const PENDING_KEY = 'karabuddyPendingRotation';
  const getPending = async () => { try { return (await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] || {}; } catch { return {}; } };
  const setPending = async (slug, kid) => { const p = await getPending(); p[slug] = kid; try { await chrome.storage.local.set({ [PENDING_KEY]: p }); } catch {} };
  const clearPending = async (slug) => { const p = await getPending(); delete p[slug]; try { await chrome.storage.local.set({ [PENDING_KEY]: p }); } catch {} };

  // kid → teamSlug, so every key (active / rotating / old) groups under its team's
  // detail view — old keys never drift into a disconnected "other keys" section.
  const KEYTEAM_KEY = 'karabuddyKeyTeam';
  const getKeyTeam = async () => { try { return (await chrome.storage.local.get(KEYTEAM_KEY))[KEYTEAM_KEY] || {}; } catch { return {}; } };
  const setKeyTeam = async (kid, slug) => { const m = await getKeyTeam(); m[kid] = slug; try { await chrome.storage.local.set({ [KEYTEAM_KEY]: m }); } catch {} };

  // Master-detail: null = the team list; a slug = that team's key-management view.
  let selectedTeamSlug = null;
  // The ?makePrivate=<slug> deep link drills into a team ONCE (on first render);
  // after that, Back works normally instead of snapping back to that team.
  let deepLinkConsumed = false;

  async function loadState() {
    const [kidsRes, teamsRes] = await Promise.all([
      sw({ type: 'listPrivateTeamKeyIds' }),
      sw({ type: 'getTeamsMentionData' }),
    ]);
    const loadedKids = (kidsRes && kidsRes.data) || [];
    const teamsBody = teamsRes && teamsRes.data;
    const signedIn = !!(teamsRes && teamsRes.ok && teamsBody && teamsBody.ok);
    // All of my teams (with role + privacy). The team-centric rows decide what to
    // show per team; key GENERATION is offered only on teams I own.
    const myTeams = signedIn ? (teamsBody.teams || []) : [];
    return { loadedKids, myTeams, signedIn, labels: await getLabels(), pending: await getPending(), keyTeam: await getKeyTeam() };
  }

  // Store a key under its derived id, after checking it matches the EXPECTED id
  // for the team the user is adding it to (catches wrong/old pastes).
  async function addKeyForTeam(team, rawKey, errNode) {
    errNode.textContent = '';
    const e = e2ee();
    const key = (rawKey || '').trim();
    if (!e || !key) return;
    let kid;
    try { kid = await e.teamKeyId(key); } catch { errNode.textContent = "That doesn't look like a valid key."; return; }
    if (kid !== team.teamKeyId) {
      // We compare the key's PUBLIC FINGERPRINT (computed on-device), not the key
      // itself — karabuddy never has the key to compare against.
      errNode.textContent = `That doesn't match the public fingerprint of ${team.name}'s key.`;
      return;
    }
    const res = await sw({ type: 'storePrivateTeamKey', teamKeyId: kid, key });
    if (!res || !res.ok) { errNode.textContent = (res && res.error) || 'Could not add that key.'; return; }
    await setLabel(kid, team.name); // auto-name by team
    await setKeyTeam(kid, team.slug);
    render();
  }

  // Stage an UPCOMING (rotation) key on top of the one already loaded, so a member
  // never loses access when the owner flips. Unlike addKeyForTeam we DON'T require
  // it to match the team's current fingerprint (the new key won't, until the flip)
  // — we only reject re-pasting the current key. The key is local-only and never
  // sent to karabuddy, so staging a wrong paste is harmless (it just never
  // activates and stays deletable); we trust the owner's out-of-band share.
  async function addUpcomingKeyForTeam(team, rawKey, errNode) {
    errNode.textContent = '';
    const e = e2ee();
    const key = (rawKey || '').trim();
    if (!e || !key) return;
    let kid;
    try { kid = await e.teamKeyId(key); } catch { errNode.textContent = "That doesn't look like a valid key."; return; }
    if (kid === team.teamKeyId) { errNode.textContent = `That's ${team.name}'s current key — you already have it loaded.`; return; }
    const res = await sw({ type: 'storePrivateTeamKey', teamKeyId: kid, key });
    if (!res || !res.ok) { errNode.textContent = (res && res.error) || 'Could not add that key.'; return; }
    await setLabel(kid, team.name + ' (new key)');
    await setKeyTeam(kid, team.slug);
    await setPending(team.slug, kid); // shows as "upcoming"; self-heals once it becomes active
    render();
  }

  async function forget(kid) {
    await sw({ type: 'forgetPrivateTeamKey', teamKeyId: kid });
    render();
  }

  // The team's "live" key on THIS device, if any: when private, the server's
  // current key id; when private mode is off, the on-device key we'd re-enable
  // with (owner only). Null = no usable key here. This one notion drives every
  // state, so a team always lives in exactly one place (its row) with its keys.
  function currentKidFor(team, loadedKids, keyTeam, labels) {
    if (team.privateMode) return team.teamKeyId;
    if (team.role === 'owner') return reuseKidForTeam(team.slug, team.name, loadedKids, keyTeam, labels);
    return null;
  }

  // One concise status per team for the list. Same buckets the detail renders.
  function teamStatus(team, loadedKids, keyTeam, labels, pending) {
    if (team.privateMode) {
      if (!loadedKids.includes(team.teamKeyId)) return { txt: '🔑 Needs key', color: '#ffb020' };
      return pending[team.slug] ? { txt: '🔄 Rotation in progress', color: '#9fe6ff' } : { txt: '✓ Ready', color: '#6fe3a3' };
    }
    const kid = currentKidFor(team, loadedKids, keyTeam, labels);
    if (kid) return { txt: 'Private mode off · key on this device', color: '#a0a8b8' };
    return { txt: 'Not private', color: '#a0a8b8' };
  }

  // MASTER list item: a clickable team row showing one concise status. Clicking
  // drills into that team's detail — only one team's complexity shows at a time.
  function teamListItem(team, loadedKids, pending, keyTeam, labels) {
    const status = teamStatus(team, loadedKids, keyTeam, labels, pending);
    const item = el('button', {
      onclick: () => { selectedTeamSlug = team.slug; render(); },
      style: 'display:flex; align-items:center; gap:12px; width:100%; text-align:left; cursor:pointer; padding:12px 14px; margin:0; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:8px; box-shadow:none;',
    });
    item.addEventListener('mouseenter', () => { item.style.background = 'rgba(77,157,255,0.08)'; item.style.borderColor = 'var(--azure)'; });
    item.addEventListener('mouseleave', () => { item.style.background = 'rgba(255,255,255,0.02)'; item.style.borderColor = 'var(--border)'; });
    item.append(
      el('div', { style: 'flex:1 1 auto; min-width:0' },
        el('div', { className: 'tname', textContent: team.name }),
        el('div', { className: 'tstatus', style: `color:${status.color}`, textContent: status.txt }),
      ),
      el('span', { style: 'flex:0 0 auto; color:var(--muted); font-size:20px; line-height:1', textContent: '›' }),
    );
    return item;
  }

  // A subtle collapsible disclosure — a quiet toggle row that shows/hides `body`.
  // Used to tuck rare actions (rotate / forget / old keys) out of the default view
  // so the everyday state (key loaded, Show key) stays uncluttered.
  function disclosure(label, body, { open = false } = {}) {
    const wrap = el('div', { style: 'margin-top:16px' });
    // Inset, bordered panel so the contents clearly read as nested INSIDE the
    // disclosure (not as more top-level sections of the card).
    const panel = 'margin-top:8px; padding:12px 14px 14px; border:1px solid var(--border); border-radius:9px; background:rgba(255,255,255,0.018)';
    body.setAttribute('style', panel + (open ? '' : '; display:none'));
    const caret = el('span', { textContent: open ? '▾' : '▸', style: 'display:inline-block; width:11px; color:var(--muted)' });
    const toggle = el('button', { className: 'ghost', style: 'display:flex; align-items:center; gap:6px; padding:5px 9px; font-size:12px; color:var(--muted)' }, caret, el('span', { textContent: label }));
    toggle.onclick = () => { const o = body.style.display === 'none'; body.style.display = o ? '' : 'none'; caret.textContent = o ? '▾' : '▸'; };
    wrap.append(toggle, body);
    return wrap;
  }

  // DETAIL: everything for ONE team — active key up top (the everyday view), with
  // the rare stuff (rotate / forget / old keys) tucked behind an "Advanced"
  // disclosure so it isn't prominent. The whole rotation still runs in this view.
  function renderTeamDetail(team, loadedKids, pending, keyTeam, labels, root) {
    const isOwner = team.role === 'owner';
    const currentKid = currentKidFor(team, loadedKids, keyTeam, labels);
    const currentLoaded = !!currentKid && loadedKids.includes(currentKid);

    root.append(el('button', {
      className: 'ghost', textContent: '‹ All teams',
      style: 'margin-bottom:14px; padding:5px 10px',
      onclick: () => { selectedTeamSlug = null; render(); },
    }));

    // Header: one status line for the team's state.
    const statusTxt = team.privateMode
      ? (currentLoaded ? '✓ Key loaded — replays open automatically' : '🔑 Key not on this device')
      : currentLoaded ? 'Private mode is off — this team’s key is still on this device'
      : isOwner ? 'Private mode is off' : 'This team isn’t private';
    const statusCls = team.privateMode ? (currentLoaded ? 'ok-txt' : 'warn-txt') : 'muted';
    const card = el('div', { className: 'card' },
      el('div', { className: 'tname', style: 'font-size:17px; margin-bottom:2px', textContent: team.name }),
      el('div', { className: 'tstatus ' + statusCls, style: 'margin-bottom:14px', textContent: statusTxt }),
    );

    // --- PRIMARY action — exactly one block, chosen by state ------------------
    if (team.privateMode && currentLoaded) {
      // Everyday: key is here, stored in this browser. Show it to share — and we
      // auto-open it once right after generating, so the owner sees + copies it.
      card.append(el('div', { className: 'label', textContent: 'Team key' }));
      const host = el('div', {});
      const keyDesc = `Share this with your teammates so they can view and record. Keep a copy somewhere safe — if it’s lost everywhere, the replays can’t be recovered, not even by us.`;
      const showBtn = el('button', { className: 'ghost', textContent: 'Show key', onclick: () => showStoredKey(currentKid, team.name, host, showBtn, keyDesc) });
      card.append(
        el('p', { className: 'muted', style: 'margin:4px 0 6px; font-size:11.5px', textContent: 'Stored in this browser on this device — replays open automatically. Show it anytime to share with a teammate.' }),
        el('div', { className: 'gap', style: 'margin:6px 0' }, showBtn), host,
      );
      if (autoRevealKid === currentKid) { autoRevealKid = null; showStoredKey(currentKid, team.name, host, showBtn, keyDesc); }
    } else if (team.privateMode && !currentLoaded) {
      // Private, but the key isn't here — paste the one a teammate shared.
      card.append(el('div', { className: 'label', textContent: 'Team key' }));
      const input = el('input', { type: 'password', placeholder: `paste ${team.name}'s key`, autocomplete: 'off', spellcheck: false });
      const err = el('div', { className: 'err' });
      const add = el('button', { textContent: 'Add key', onclick: () => addKeyForTeam(team, input.value, err) });
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addKeyForTeam(team, input.value, err); } });
      card.append(el('p', { className: 'muted', style: 'margin:4px 0 6px; font-size:11.5px', textContent: 'A teammate shared this team’s key with you — paste it to view and record.' }), el('div', { className: 'inline-add' }, input, add), err);
    } else if (!team.privateMode && currentLoaded) {
      // Owner, off, but this team's key is still here → re-enable reuses it.
      card.append(el('div', { className: 'label', textContent: 'Team key' }));
      const host = el('div', {});
      const err = el('div', { className: 'err' });
      const confirmHost = el('div', {});
      const showBtn = el('button', { className: 'ghost', textContent: 'Show key', onclick: () => showStoredKey(currentKid, team.name, host, showBtn, `${team.name}'s key — still on this device. Re-enabling reuses it; share it with a teammate who needs it.`) });
      const reBtn = el('button', { textContent: 'Re-enable private mode' });
      reBtn.onclick = () => askConfirm(confirmHost, {
        message: `Re-enable end-to-end encryption for ${team.name} using the key already on THIS device, so its existing encrypted replays stay readable. (A new key would orphan them.)`,
        confirmLabel: 'Re-enable with this key',
        onConfirm: () => makeTeamPrivate(team, reBtn, err, currentKid),
      });
      card.append(
        el('p', { className: 'muted', style: 'margin:4px 0 6px; font-size:11.5px', textContent: 'Private mode is off, but this team’s key is still here. Re-enable to make new replays encrypted again — its existing encrypted replays stay readable.' }),
        el('div', { className: 'gap', style: 'margin:6px 0' }, reBtn, showBtn), host, confirmHost, err,
      );
    } else if (!team.privateMode && isOwner) {
      // Owner, off, no key here → first-time enable (generate).
      card.append(el('div', { className: 'label', textContent: 'Make this team private' }));
      const err = el('div', { className: 'err' });
      const confirmHost = el('div', {});
      const btn = el('button', { textContent: 'Generate key & turn on private mode' });
      btn.onclick = () => askConfirm(confirmHost, {
        message: `Turn on end-to-end encryption for ${team.name}? A key is generated on THIS device — share it with teammates so they can view and record. Replays uploaded while private can't be read without the key, and the key never reaches karabuddy.`,
        confirmLabel: 'Generate key & turn on',
        onConfirm: () => makeTeamPrivate(team, btn, err),
      });
      card.append(
        el('p', { className: 'muted', style: 'margin:4px 0 12px; font-size:11.5px', textContent: 'Generates the team’s encryption key on this device and turns private mode on — all here. Then share the key with your teammates.' }),
        el('div', { className: 'gap' }, btn), confirmHost, err,
      );
    } else {
      // Member, not private — nothing to do here.
      card.append(el('p', { className: 'muted', style: 'margin:0; font-size:12px', textContent: 'This team isn’t using private mode. If it’s turned on, a teammate will share the key and you’ll add it here.' }));
    }

    // --- Upcoming key (members, private) — stage the next key before a rotation -
    if (team.privateMode && !isOwner && currentLoaded) {
      card.append(upcomingKeySection(team, loadedKids, pending));
    }

    // --- Advanced: the rare stuff, tucked away. Forget (if a key is here), Rotate
    // (private owner), and any rotated-out / extra keys grouped under this team. --
    const prevKids = loadedKids.filter((k) => keyTeam[k] === team.slug && k !== currentKid && k !== pending[team.slug]);
    const rotating = team.privateMode && isOwner && !!pending[team.slug];
    const adv = el('div', { style: 'padding-top:4px' });
    let hasAdv = false;

    if (currentLoaded) {
      hasAdv = true;
      const confirmHost = el('div', {});
      const forgetBtn = el('button', { className: 'warn', textContent: 'Forget key on this device' });
      forgetBtn.onclick = () => askConfirm(confirmHost, {
        danger: true,
        message: team.privateMode
          ? `Forget ${team.name}'s key on THIS device? You'll lose access to its replays here and can't record for it until the key is shared again. No undo unless you saved it.`
          : `Forget ${team.name}'s key on THIS device? You'd no longer be able to re-enable the team here, and its existing encrypted replays would be unrecoverable. No undo unless you saved it.`,
        confirmLabel: 'Forget key',
        onConfirm: () => forget(currentKid),
      });
      adv.append(
        el('div', { className: 'label', textContent: 'Forget key' }),
        el('p', { className: 'muted', style: 'margin:4px 0 6px; font-size:11.5px', textContent: 'Remove this key from this device only (e.g. a shared computer). Doesn’t affect the team or other members.' }),
        el('div', { className: 'gap', style: 'margin:4px 0' }, forgetBtn), confirmHost,
      );
    }

    if (team.privateMode && isOwner && currentLoaded) {
      hasAdv = true;
      adv.append(el('div', { className: 'label', style: 'margin-top:16px', textContent: 'Rotate key' }));
      adv.append(rotationSection(team, loadedKids, pending[team.slug]));
    }

    if (prevKids.length) {
      hasAdv = true;
      adv.append(el('div', { className: 'label', style: 'margin-top:16px', textContent: 'Previous keys' }));
      adv.append(el('p', { className: 'muted', style: 'margin:4px 0 8px; font-size:11.5px', textContent: 'Older keys for this team, no longer active. Safe to delete unless you kept encrypted copies that still need them.' }));
      for (const k of prevKids) {
        const host = el('div', {});
        const confirmHost = el('div', {});
        const showBtn = el('button', { className: 'ghost', textContent: 'Show key', onclick: () => showStoredKey(k, team.name, host, showBtn, 'An older key for this team — no longer active. Shown in case you kept encrypted copies that still need it.') });
        const delBtn = el('button', { className: 'warn', textContent: 'Delete' });
        delBtn.onclick = () => askConfirm(confirmHost, {
          message: `Delete this older key for ${team.name}? It's no longer active, but any encrypted copies you kept would need it. There's no undo.`,
          confirmLabel: 'Delete key',
          onConfirm: () => forget(k),
        });
        adv.append(
          el('div', { className: 'team-row' },
            el('div', { className: 'tcol' },
              el('div', { className: 'tname', textContent: 'Old key' }),
              el('div', { className: 'tstatus muted', textContent: 'inactive' }),
            ),
            showBtn,
            delBtn,
          ),
          host,
          confirmHost,
        );
      }
    }

    // Collapsed by default (rare actions) — but keep it OPEN while a rotation is
    // mid-flight, so the new key + share instructions stay visible right after you
    // click Rotate.
    if (hasAdv) card.append(disclosure(rotating ? 'Advanced · 🔄 rotation in progress' : 'Advanced', adv, { open: rotating }));

    root.append(card);
  }

  // Member-side "add the upcoming key" affordance, shown under a team whose current
  // key is already loaded. Quiet + collapsible when nothing's staged (no noise in
  // the common no-rotation case); once a new key is staged it shows a clear
  // "added — activates on the owner's rotation" state with Show / Remove.
  function upcomingKeySection(team, loadedKids, pending) {
    const newKid = pending[team.slug];
    const box = el('div', { style: 'margin-top:16px' });
    if (newKid && loadedKids.includes(newKid)) {
      box.append(el('div', { className: 'label', textContent: 'Upcoming key' }));
      const host = el('div', {});
      const showBtn = el('button', { className: 'ghost', textContent: 'Show key', onclick: () => showStoredKey(newKid, team.name, host, showBtn, 'The new key your team owner shared. It takes over automatically when they run the rotation.') });
      box.append(
        el('p', { className: 'ok-txt', style: 'margin:4px 0 8px; font-size:11.5px', textContent: '✓ New key added — it takes over automatically the moment your team owner runs the rotation. Keep your current key until then.' }),
        el('div', { className: 'gap', style: 'margin:6px 0' }, showBtn, el('button', { className: 'warn', textContent: 'Remove', onclick: () => { clearPending(team.slug); forget(newKid); } })),
        host,
      );
      return box;
    }
    // Nothing staged → a quiet toggle that reveals the paste box on demand.
    const err = el('div', { className: 'err' });
    const input = el('input', { type: 'password', placeholder: `paste ${team.name}'s new key`, autocomplete: 'off', spellcheck: false });
    const add = el('button', { textContent: 'Add new key', onclick: () => addUpcomingKeyForTeam(team, input.value, err) });
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addUpcomingKeyForTeam(team, input.value, err); } });
    const form = el('div', { style: 'display:none; margin-top:6px' },
      el('p', { className: 'muted', style: 'margin:0 0 6px; font-size:11.5px', textContent: 'If your team owner shared a NEW key for an upcoming rotation, add it now — it takes over the moment they run the rotation, so you never lose access.' }),
      el('div', { className: 'inline-add' }, input, add),
      err,
    );
    const toggle = el('button', { className: 'ghost', style: 'padding:4px 8px; font-size:11.5px', textContent: '＋ Got a new key from your team owner?' });
    toggle.onclick = () => { const open = form.style.display === 'none'; form.style.display = open ? '' : 'none'; if (open) input.focus(); };
    box.append(toggle, form);
    return box;
  }

  // The rotation sub-section under an owned team. No pending rotation → a quiet
  // "Rotate key" action. Pending → the new key (share it) + Run / Cancel, all here.
  function rotationSection(team, loadedKids, newKid) {
    const box = el('div', { style: 'padding: 6px 0 2px 23px; display: flex; flex-direction: column; gap: 6px; border-left: 2px solid rgba(77,210,255,0.18); margin: 4px 0 2px;' });
    if (!newKid) {
      box.append(el('button', { className: 'ghost', textContent: 'Rotate key', onclick: () => generateRotationKey(team) }));
      box.append(el('p', { className: 'muted', style: 'margin:0; font-size:11px', textContent: 'Replace this team’s key (e.g. if it leaked or a member left). Existing replays are re-encrypted under the new key.' }));
      return box;
    }
    const newLoaded = loadedKids.includes(newKid);
    box.append(el('div', { className: 'label', style: 'margin:0', textContent: '🔄 New key — rotating in' }));
    box.append(el('p', { className: 'muted', style: 'margin:0; font-size:11px', textContent: newLoaded ? 'Share this key with your team and have them load it FIRST, then run the rotation — it re-encrypts existing replays under the new key and switches the team over.' : 'The new key isn’t on this device — can’t run the rotation. Cancel and start over.' }));
    const host = el('div', {});
    const newKeyDesc = `Send this new key to ${team.name}'s members and have them load it BEFORE you run the rotation, so they don't lose access.`;
    const showBtn = el('button', { className: 'ghost', textContent: 'Show new key', onclick: () => showStoredKey(newKid, team.name, host, showBtn, newKeyDesc) });
    const progress = el('div', { className: 'muted', style: 'font-size:11.5px' });
    const runBtn = el('button', { textContent: 'Run rotation', disabled: !newLoaded, onclick: () => runRotation(team, newKid, progress, runBtn, cancelBtn) });
    const cancelBtn = el('button', { className: 'warn', textContent: 'Cancel', onclick: () => cancelRotation(team, newKid) });
    box.append(el('div', { className: 'gap' }, showBtn), host, el('div', { className: 'gap' }, runBtn, cancelBtn), progress);
    // Just minted → reveal it straight away so the owner can copy + share it.
    if (autoRevealKid === newKid) { autoRevealKid = null; showStoredKey(newKid, team.name, host, showBtn, newKeyDesc); }
    return box;
  }

  // Mint the NEW key for an in-place rotation: stored, labelled, and recorded as
  // this team's pending rotation key (shown in its card until the rotation runs).
  async function generateRotationKey(team) {
    const e = e2ee(); if (!e) return;
    const { key, teamKeyId } = await e.generateTeamKey();
    await sw({ type: 'storePrivateTeamKey', teamKeyId, key });
    await setLabel(teamKeyId, team.name + ' (new key)');
    await setKeyTeam(teamKeyId, team.slug);
    await setPending(team.slug, teamKeyId);
    autoRevealKid = teamKeyId; // open the new key's reveal once, ready to share
    render();
  }

  async function cancelRotation(team, newKid) {
    await clearPending(team.slug);
    await sw({ type: 'forgetPrivateTeamKey', teamKeyId: newKid }); // it was only for this aborted rotation
    render();
  }

  // Run the whole rotation here: reveal both keys (this trusted page only),
  // re-wrap every replay's payload + summary + encrypted comments old→new (the
  // content ciphertext is untouched), then flip the team. Resumable — the manifest
  // only lists replays still under the old key.
  async function runRotation(team, newKid, progress, runBtn, cancelBtn) {
    const e = e2ee(); if (!e) return;
    runBtn.disabled = true; cancelBtn.disabled = true;
    progress.textContent = 'Preparing…';
    try {
      const oldRes = await sw({ type: 'revealPrivateTeamKey', teamKeyId: team.teamKeyId });
      const newRes = await sw({ type: 'revealPrivateTeamKey', teamKeyId: newKid });
      if (!oldRes?.data?.key || !newRes?.data?.key) throw new Error('Both the current and new keys must be loaded on this device.');
      const oldKey = oldRes.data.key, newKey = newRes.data.key;
      const manRes = await sw({ type: 'rotationManifest', teamSlug: team.slug });
      if (!manRes?.ok) throw new Error((manRes?.data && manRes.data.error) || 'Could not load the rotation list.');
      const reps = manRes.data.replays || [];
      for (let i = 0; i < reps.length; i++) {
        progress.textContent = `Re-encrypting replays… ${i}/${reps.length}`;
        const r = reps[i];
        const blobEnv = await (await fetch(r.payloadBlobUrl)).json();
        const payload = JSON.stringify(await e.rewrapKey(oldKey, newKey, blobEnv));
        const encryptedSummary = r.encryptedSummary ? JSON.stringify(await e.rewrapKey(oldKey, newKey, JSON.parse(r.encryptedSummary))) : '';
        const tags = [];
        for (const t of (r.tags || [])) tags.push({ id: t.id, commentEncrypted: JSON.stringify(await e.rewrapKey(oldKey, newKey, JSON.parse(t.commentEncrypted))) });
        const rw = await sw({ type: 'rotationRewrap', slug: r.slug, newTeamKeyId: newKid, payload, encryptedSummary, tags });
        if (!rw?.ok) throw new Error((rw?.data && rw.data.error) || `Failed re-encrypting a replay (${r.slug}).`);
      }
      progress.textContent = 'Finalizing…';
      const fin = await sw({ type: 'rotationFinalize', teamSlug: team.slug, newTeamKeyId: newKid });
      if (!fin?.ok) throw new Error((fin?.data && fin.data.error) || 'Could not finalize the rotation.');
      await setLabel(team.teamKeyId, team.name + ' (old key)'); // now inactive
      await setKeyTeam(team.teamKeyId, team.slug); // keep the old key grouped under its team
      await setLabel(newKid, team.name);
      await setKeyTeam(newKid, team.slug);
      await clearPending(team.slug);
      render();
    } catch (err) {
      progress.textContent = '⚠ ' + (err?.message || 'Rotation failed.');
      runBtn.disabled = false; cancelBtn.disabled = false;
    }
  }

  // Reveal a STORED key inline (toggle) so the owner can re-share it — the SW
  // hands back the value only to this trusted extension page. Click again hides.
  async function showStoredKey(teamKeyId, teamName, host, btn, desc) {
    if (host.childNodes.length) { host.innerHTML = ''; host.removeAttribute('style'); btn.textContent = 'Show key'; return; }
    btn.disabled = true;
    const res = await sw({ type: 'revealPrivateTeamKey', teamKeyId });
    btn.disabled = false;
    if (!res || !res.ok || !res.data || !res.data.key) {
      host.setAttribute('style', 'margin-top:8px');
      host.append(el('div', { className: 'err', textContent: res && res.error === 'no-key' ? 'That key isn’t on this device.' : 'Couldn’t read the key.' }));
      return;
    }
    btn.textContent = 'Hide';
    const key = res.data.key;
    host.setAttribute('style', 'font: 14px var(--font); color: var(--text); background: rgba(77,157,255,0.05); border: 1px solid rgba(77,157,255,0.28); border-radius: 10px; padding: 14px; margin-top: 10px;');
    const copyBtn = el('button', { textContent: 'Copy key', onclick: async () => {
      try { await navigator.clipboard.writeText(key); copyBtn.textContent = 'Copied ✓'; setTimeout(() => { copyBtn.textContent = 'Copy key'; }, 1600); } catch {}
    } });
    host.append(
      el('div', { className: 'muted', style: 'font-size:12.5px; margin-bottom:8px', textContent: desc || `Send this to teammates so they can open ${teamName}’s replays.` }),
      el('div', { style: 'font: 600 14px var(--mono); color:#eaf6ff; background:#0b0e13; border:1px solid var(--azure); border-radius:8px; padding:12px 13px; word-break:break-all; user-select:all; line-height:1.5', textContent: key }),
      el('div', { className: 'gap', style: 'margin-top:10px' }, copyBtn),
    );
  }

  // RE-ENABLE guard: does THIS device already hold the team's key from when it was
  // private before? If so we reuse it instead of minting a fresh one — the team's
  // existing encrypted replays are bound to it, and enabling with a new key would
  // orphan them. We take a key grouped under this team (keyTeam) that isn't a
  // rotation artefact, preferring the one labelled with the exact team name.
  function reuseKidForTeam(slug, teamName, loadedKids, keyTeam, labels) {
    const artefact = /\((old|new) key\)\s*$/i;
    const candidates = loadedKids.filter((k) => keyTeam[k] === slug && !artefact.test(labels[k] || ''));
    return candidates.find((k) => (labels[k] || '') === teamName) || candidates[0] || null;
  }

  // Turn private mode on (server) for a team I own. First-time → generate the key
  // on-device; RE-enable when this device still has the team's key → reuse it
  // (`reuseKid`) so existing encrypted replays stay readable. Owner-only
  // (server-enforced). On any error we surface it and forget a just-minted key.
  async function makeTeamPrivate(team, btn, errNode, reuseKid) {
    const e = e2ee(); if (!e) return;
    if (errNode) errNode.textContent = '';
    const origLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
    let key = null, teamKeyId = reuseKid || null;
    if (!reuseKid) {
      ({ key, teamKeyId } = await e.generateTeamKey());
      await sw({ type: 'storePrivateTeamKey', teamKeyId, key });
    }
    const res = await sw({ type: 'enablePrivateMode', teamSlug: team.slug, teamKeyId });
    if (!res || !res.ok) {
      if (!reuseKid) await sw({ type: 'forgetPrivateTeamKey', teamKeyId }); // don't leave an unused fresh key around
      if (errNode) errNode.textContent = (res && res.data && res.data.error) || 'Could not turn on private mode.';
      if (btn) { btn.disabled = false; btn.textContent = origLabel; }
      return;
    }
    await setLabel(teamKeyId, team.name);
    await setKeyTeam(teamKeyId, team.slug);
    selectedTeamSlug = team.slug; // drill into the team
    // Fresh key → auto-open its reveal once so the owner sees + copies it. Reused
    // key → already shared before; just land in the detail (Show key is there).
    autoRevealKid = reuseKid ? null : teamKeyId;
    render();
  }

  // Signed-out / offline fallback: can't name by team, so paste a key directly.
  function renderSignedOut(loadedKids, labels, root) {
    const card = el('div', { className: 'card' }, el('div', { className: 'label', textContent: 'Add a team key' }));
    card.append(el('p', { className: 'muted', style: 'margin:0 0 8px', textContent: 'Sign in on karabuddy (with this extension) to manage keys by team name. For now, paste a key your lead shared:' }));
    const input = el('input', { type: 'password', placeholder: 'paste team key', autocomplete: 'off', spellcheck: false });
    const err = el('div', { className: 'err' });
    const add = el('button', { textContent: 'Add key', onclick: async () => {
      const e = e2ee(); const key = input.value.trim(); if (!e || !key) return;
      let kid; try { kid = await e.teamKeyId(key); } catch { err.textContent = 'Invalid key.'; return; }
      const res = await sw({ type: 'storePrivateTeamKey', teamKeyId: kid, key });
      if (res && res.ok) render(); else err.textContent = (res && res.error) || 'Could not add that key.';
    } });
    card.append(el('div', { className: 'inline-add' }, input, add), err);
    card.append(el('p', { className: 'muted', style: 'margin:12px 0 0; font-size:11.5px', textContent: 'Sign in to make a team private — key creation is tied to a team you own.' }));
    if (loadedKids.length) {
      card.append(el('div', { className: 'label', style: 'margin-top:14px', textContent: 'Loaded keys' }));
      for (const k of loadedKids) {
        card.append(el('div', { className: 'team-row' },
          el('div', { className: 'tcol' }, el('div', { className: 'tname', textContent: labels[k] || 'Team key' }), el('div', { className: 'tstatus muted', textContent: 'public id: ' + k })),
          el('button', { className: 'warn', textContent: 'Forget', onclick: () => forget(k) }),
        ));
      }
    }
    root.append(card);
  }

  async function render() {
    const { loadedKids, myTeams, signedIn, labels, pending, keyTeam } = await loadState();
    const root = $('content');
    root.innerHTML = '';

    if (!signedIn) { renderSignedOut(loadedKids, labels, root); return; }

    // Self-heal a stale "pending"/upcoming marker: once the team has flipped to the
    // staged key (server's teamKeyId == pending), the rotation is done — drop the
    // marker so it stops showing as "rotating"/"upcoming" for owner AND member.
    for (const t of myTeams) {
      if (t.privateMode && t.teamKeyId && pending[t.slug] === t.teamKeyId) { delete pending[t.slug]; clearPending(t.slug); }
    }

    // The ?makePrivate=<slug> deep link drills into that team's detail — once.
    if (!deepLinkConsumed) {
      deepLinkConsumed = true;
      const dl = new URLSearchParams(location.search).get('makePrivate');
      if (dl) selectedTeamSlug = dl;
    }

    // Privacy-relevant teams: anything private, anything I own (so I can make it
    // private), or anything I hold a key for on this device. Each is ONE row that
    // drills into ONE state-driven detail — a team never splits across sections.
    const relevant = myTeams.filter((t) => t.privateMode || t.role === 'owner' || loadedKids.some((k) => keyTeam[k] === t.slug));
    const selected = selectedTeamSlug ? relevant.find((t) => t.slug === selectedTeamSlug) : null;
    if (selected) { renderTeamDetail(selected, loadedKids, pending, keyTeam, labels, root); return; }

    // MASTER — one list of your teams.
    const teamsCard = el('div', { className: 'card' },
      el('div', { className: 'label', textContent: 'Your teams' }),
      el('p', { className: 'muted', style: 'margin:0 0 12px', textContent: 'Each team’s private-mode status and its key on this device. Click a team to load, share, rotate, or turn on private mode. Keys are matched by a fingerprint computed here — never sent to karabuddy.' }),
    );
    if (relevant.length === 0) {
      teamsCard.append(el('p', { className: 'muted', style: 'margin:0', textContent: 'No private teams, and none you own to make private.' }));
    } else {
      const list = el('div', { style: 'display:flex; flex-direction:column; gap:8px' });
      for (const t of relevant) list.append(teamListItem(t, loadedKids, pending, keyTeam, labels));
      teamsCard.append(list);
    }
    root.append(teamsCard);

    // UNATTACHED keys — on this device but not tied to ANY of your teams (a team
    // you left, or a stray paste). Every key for one of your teams lives in that
    // team's detail (active / previous / re-enable), so nothing of yours lands here.
    const mySlugs = new Set(myTeams.map((t) => t.slug));
    const attached = new Set();
    myTeams.forEach((t) => { if (t.teamKeyId) attached.add(t.teamKeyId); if (pending[t.slug]) attached.add(pending[t.slug]); });
    loadedKids.forEach((k) => { if (keyTeam[k] && mySlugs.has(keyTeam[k])) attached.add(k); });
    const unattached = loadedKids.filter((k) => !attached.has(k));
    if (unattached.length) {
      const card = el('div', { className: 'card' },
        el('div', { className: 'label', textContent: 'Unattached keys' }),
        el('p', { className: 'muted', style: 'margin:0 0 8px', textContent: 'Keys on this device not tied to any of your teams — e.g. a team you left, or a stray paste. Show one to compare it with a key a teammate mentions, or delete keys you no longer need.' }),
      );
      for (const k of unattached) {
        const host = el('div', {});
        const confirmHost = el('div', {});
        const showBtn = el('button', { className: 'ghost', textContent: 'Show key', onclick: () => showStoredKey(k, labels[k] || 'this key', host, showBtn, 'Not tied to any of your teams. Shown so you can compare it with a key a teammate mentions.') });
        const delBtn = el('button', { className: 'warn', textContent: 'Delete' });
        delBtn.onclick = () => askConfirm(confirmHost, {
          message: `Delete this key from this device? It isn't tied to any of your teams. There's no undo unless you saved it elsewhere.`,
          confirmLabel: 'Delete key',
          onConfirm: () => forget(k),
        });
        card.append(
          el('div', { className: 'team-row' },
            el('div', { className: 'tcol' },
              el('div', { className: 'tname', textContent: labels[k] || 'Unrecognized key' }),
              el('div', { className: 'tstatus muted', textContent: labels[k] ? 'not tied to a current team' : 'unrecognized key' }),
            ),
            showBtn,
            delBtn,
          ),
          host,
          confirmHost,
        );
      }
      root.append(card);
    }
  }

  document.addEventListener('DOMContentLoaded', render);
})();
