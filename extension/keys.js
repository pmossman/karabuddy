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
  // The just-generated key, kept across re-renders so its VALUE stays on screen
  // (with a copy button) until the user dismisses it. Without this, render()
  // wipes #content right after generate() and the value is lost — the only place
  // a freshly minted key is ever shown.
  let lastGenerated = null;
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

  async function forget(kid) {
    await sw({ type: 'forgetPrivateTeamKey', teamKeyId: kid });
    render();
  }

  // MASTER list item: a clickable team row showing one concise status. Clicking
  // drills into that team's detail — only one team's complexity shows at a time.
  function teamListItem(team, loadedKids, pending) {
    const loaded = loadedKids.includes(team.teamKeyId);
    const rotating = !!pending[team.slug];
    const status = rotating
      ? { txt: '🔄 Rotation in progress', color: '#9fe6ff' }
      : loaded
        ? { txt: '✓ Ready', color: '#6fe3a3' }
        : { txt: '🔑 Needs key', color: '#ffb020' };
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

  // DETAIL: everything for ONE team — active key, rotation, and any previous
  // (rotated-out) keys, all grouped here. The whole rotation runs in this view.
  function renderTeamDetail(team, loadedKids, pending, keyTeam, root) {
    const isOwner = team.role === 'owner';
    const activeLoaded = loadedKids.includes(team.teamKeyId);

    // Back to the team list.
    const back = el('button', {
      className: 'ghost', textContent: '‹ All private teams',
      style: 'margin-bottom:14px; padding:5px 10px',
      onclick: () => { selectedTeamSlug = null; render(); },
    });
    root.append(back);

    const card = el('div', { className: 'card' },
      el('div', { className: 'tname', style: 'font-size:17px; margin-bottom:2px', textContent: team.name }),
      el('div', { className: 'tstatus ' + (activeLoaded ? 'ok-txt' : 'warn-txt'), style: 'margin-bottom:14px', textContent: activeLoaded ? '✓ Active key loaded — replays open automatically' : '🔑 The active key isn’t loaded on this device' }),
    );

    // --- Active key ---
    card.append(el('div', { className: 'label', textContent: 'Active key' }));
    if (activeLoaded) {
      const host = el('div', {});
      const showBtn = el('button', { className: 'ghost', textContent: 'Show key', onclick: () => showStoredKey(team.teamKeyId, team.name, host, showBtn) });
      card.append(el('div', { className: 'gap', style: 'margin:6px 0' }, showBtn, el('button', { className: 'warn', textContent: 'Forget', onclick: () => forget(team.teamKeyId) })), host);
    } else {
      const input = el('input', { type: 'password', placeholder: `paste ${team.name}'s key`, autocomplete: 'off', spellcheck: false });
      const err = el('div', { className: 'err' });
      const add = el('button', { textContent: 'Add key', onclick: () => addKeyForTeam(team, input.value, err) });
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addKeyForTeam(team, input.value, err); } });
      card.append(el('p', { className: 'muted', style: 'margin:4px 0 6px; font-size:11.5px', textContent: 'A teammate shared this team’s key with you — paste it to view and record.' }), el('div', { className: 'inline-add' }, input, add), err);
    }

    // --- Rotation (owner only) ---
    if (isOwner) {
      card.append(el('div', { className: 'label', style: 'margin-top:18px', textContent: 'Rotate key' }));
      card.append(rotationSection(team, loadedKids, pending[team.slug]));
    }

    // --- Previous (rotated-out) keys for THIS team ---
    const prevKids = loadedKids.filter((k) => keyTeam[k] === team.slug && k !== team.teamKeyId && k !== pending[team.slug]);
    if (prevKids.length) {
      card.append(el('div', { className: 'label', style: 'margin-top:18px', textContent: 'Previous keys' }));
      card.append(el('p', { className: 'muted', style: 'margin:4px 0 8px; font-size:11.5px', textContent: 'Replaced by rotation and no longer active. Safe to delete from this device.' }));
      for (const k of prevKids) {
        const host = el('div', {});
        const showBtn = el('button', { className: 'ghost', textContent: 'Show key', onclick: () => showStoredKey(k, team.name, host, showBtn, 'This key was rotated out — no longer active. Shown in case you kept old encrypted copies that still need it.') });
        card.append(
          el('div', { className: 'team-row' },
            el('div', { className: 'tcol' },
              el('div', { className: 'tname', textContent: 'Old key' }),
              el('div', { className: 'tstatus muted', textContent: 'inactive' }),
            ),
            showBtn,
            el('button', { className: 'warn', textContent: 'Delete', onclick: () => forget(k) }),
          ),
          host,
        );
      }
    }

    root.append(card);
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
    box.append(el('p', { className: 'muted', style: 'margin:0; font-size:11px', textContent: newLoaded ? 'Share this key with your team, then run the rotation to re-encrypt existing replays under it.' : 'The new key isn’t on this device — can’t run the rotation. Cancel and start over.' }));
    const host = el('div', {});
    const showBtn = el('button', { className: 'ghost', textContent: 'Show new key', onclick: () => showStoredKey(newKid, team.name + ' (new)', host, showBtn) });
    const progress = el('div', { className: 'muted', style: 'font-size:11.5px' });
    const runBtn = el('button', { textContent: 'Run rotation', disabled: !newLoaded, onclick: () => runRotation(team, newKid, progress, runBtn, cancelBtn) });
    const cancelBtn = el('button', { className: 'warn', textContent: 'Cancel', onclick: () => cancelRotation(team, newKid) });
    box.append(el('div', { className: 'gap' }, showBtn), host, el('div', { className: 'gap' }, runBtn, cancelBtn), progress);
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

  // Focused "turn private mode on for THIS team" panel, shown only when the team's
  // Settings deep-linked here (?makePrivate=<slug>) and the team is one I own that
  // isn't private yet. Couples key creation to the enable action.
  function makePrivatePanel(team) {
    const card = el('div', { className: 'card' },
      el('div', { className: 'label', textContent: 'Make this team private' }),
      el('div', { className: 'tname', style: 'margin-bottom:6px', textContent: team.name }),
      el('p', { className: 'muted', style: 'margin:0 0 12px', textContent: 'Generate this team’s encryption key here, then return to the team’s Settings and pick it to turn private mode on. Share the key with your teammates so they can view and record.' }),
      el('div', { className: 'gap' }, el('button', { textContent: 'Generate this team’s key', onclick: () => generateForTeam(team) })),
    );
    return card;
  }

  // Mint a key FOR A SPECIFIC TEAM I own — either to turn private mode on
  // (team not yet private) or to rotate (already private). Labeled by team name;
  // stashed so render() shows the value (see fillReveal / lastGenerated).
  async function generateForTeam(team) {
    const e = e2ee(); if (!e) return;
    const { key, teamKeyId } = await e.generateTeamKey();
    await sw({ type: 'storePrivateTeamKey', teamKeyId, key });
    await setLabel(teamKeyId, team.name);
    await setKeyTeam(teamKeyId, team.slug);
    lastGenerated = { key, teamKeyId, teamName: team.name, teamSlug: team.slug, mode: team.privateMode ? 'rotate' : 'enable' };
    render();
  }

  // Show a just-generated key the foolproof way: the KEY is the hero (a big,
  // bordered, click-to-select box), with a one-line "what to do" + Copy button.
  // No public id / jargon — the average user just needs to copy + share the key.
  function fillReveal(out, gen) {
    out.innerHTML = '';
    out.setAttribute('style', 'font: 14px var(--font); color: var(--text); background: rgba(77,157,255,0.05); border: 1px solid rgba(77,157,255,0.28); border-radius: 10px; padding: 16px;');
    const copyBtn = el('button', { textContent: 'Copy key', onclick: async () => {
      try { await navigator.clipboard.writeText(gen.key); copyBtn.textContent = 'Copied ✓'; setTimeout(() => { copyBtn.textContent = 'Copy key'; }, 1600); } catch {}
    } });
    const nextStep = gen.mode === 'rotate'
      ? `Then open ${gen.teamName}’s Settings → “Rotate team key” and pick this key.`
      : `Then open ${gen.teamName}’s Settings, turn on private mode, and pick this key.`;
    out.append(
      el('div', { style: 'font-weight:700; font-size:15px; color:var(--textBright); margin-bottom:3px', textContent: gen.teamName ? `New key for ${gen.teamName}` : 'Your new team key' }),
      el('div', { className: 'muted', style: 'font-size:12.5px; margin-bottom:12px', textContent: 'Copy it and send it to your teammates so they can open this team’s replays.' }),
      el('div', { style: 'font: 600 15px var(--mono); color:#eaf6ff; background:#0b0e13; border:1px solid var(--azure); border-radius:8px; padding:14px 15px; word-break:break-all; user-select:all; line-height:1.5' , textContent: gen.key }),
      el('div', { className: 'gap', style: 'margin-top:12px' },
        copyBtn,
        el('button', { className: 'ghost', textContent: 'I’ve saved it', onclick: () => { lastGenerated = null; render(); } }),
      ),
      el('div', { style: 'font-size:12px; color:var(--accent); margin-top:12px', textContent: nextStep }),
      el('div', { className: 'muted', style: 'font-size:11.5px; margin-top:8px', textContent: '⚠ Keep it somewhere safe — if it’s lost, the replays can’t be recovered, not even by us.' }),
    );
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

    const privateTeams = myTeams.filter((t) => t.privateMode && t.teamKeyId);
    const selected = selectedTeamSlug ? privateTeams.find((t) => t.slug === selectedTeamSlug) : null;

    // DETAIL — only the chosen team's keys, nothing else competing for attention.
    if (selected) { renderTeamDetail(selected, loadedKids, pending, keyTeam, root); return; }

    // MASTER — the team list (+ enable/just-generated affordances).
    if (lastGenerated) { const reveal = el('div', {}); fillReveal(reveal, lastGenerated); root.append(reveal); }

    // Deep-linked from a team's Settings "Make this team private" → focused enable
    // panel for that exact team (re-verified: I own it, not yet private).
    const makePrivateSlug = new URLSearchParams(location.search).get('makePrivate');
    if (makePrivateSlug && !lastGenerated) {
      const focus = myTeams.find((t) => t.slug === makePrivateSlug && t.role === 'owner' && !t.privateMode);
      if (focus) root.append(makePrivatePanel(focus));
    }

    const teamsCard = el('div', { className: 'card' },
      el('div', { className: 'label', textContent: 'Your private teams' }),
      el('p', { className: 'muted', style: 'margin:0 0 12px', textContent: 'Click a team to load or manage its key. Keys are matched by a fingerprint computed here — never sent to karabuddy.' }),
    );
    if (privateTeams.length === 0) {
      teamsCard.append(el('p', { className: 'muted', style: 'margin:0', textContent: 'None of your teams use private mode yet. To make a team you own private, turn it on in that team’s Settings on karabuddy.' }));
    } else {
      const list = el('div', { style: 'display:flex; flex-direction:column; gap:8px' });
      for (const t of privateTeams) list.append(teamListItem(t, loadedKids, pending));
      teamsCard.append(list);
    }
    root.append(teamsCard);

    // Truly-unrecognized keys: not any current private team's active/pending key,
    // and not grouped under one in its detail (keyTeam). Rare — a team you left or
    // a stray paste. (A rotated-out OLD key of a current team lives in that team's
    // detail under "Previous keys", not here.)
    const accounted = new Set();
    privateTeams.forEach((t) => { accounted.add(t.teamKeyId); if (pending[t.slug]) accounted.add(pending[t.slug]); });
    const currentSlugs = new Set(privateTeams.map((t) => t.slug));
    const orphans = loadedKids.filter((k) => !accounted.has(k) && !(keyTeam[k] && currentSlugs.has(keyTeam[k])) && k !== lastGenerated?.teamKeyId);
    if (orphans.length) {
      const orphCard = el('div', { className: 'card' },
        el('div', { className: 'label', textContent: 'Other keys on this device' }),
        el('p', { className: 'muted', style: 'margin:0 0 8px', textContent: 'Not tied to any of your current private teams (e.g. a team you left, or an old key). Safe to delete.' }),
      );
      for (const k of orphans) {
        orphCard.append(el('div', { className: 'team-row' },
          el('div', { className: 'tcol' },
            el('div', { className: 'tname', textContent: labels[k] || 'Unrecognized key' }),
            el('div', { className: 'tstatus muted', textContent: 'public id: ' + k }),
          ),
          el('button', { className: 'warn', textContent: 'Delete', onclick: () => forget(k) }),
        ));
      }
      root.append(orphCard);
    }
  }

  document.addEventListener('DOMContentLoaded', render);
})();
