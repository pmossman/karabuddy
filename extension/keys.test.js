// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// B170: render-harness tests for the trusted key manager (keys.js). keys.js is a
// self-running IIFE that drives the DOM via chrome.* + window.__KaraBuddy.replays
// .e2ee — it can't be eval'd and called like the other modules, so we stub those,
// CAPTURE its render() (instead of letting it register on DOMContentLoaded, which
// would accumulate across evals), and assert the real DOM it produces.
//
// These exist because keys.js has a fiddly per-team state machine and we kept
// shipping "blank detail" / wrong-section regressions that only showed up by
// reloading the extension. The headline guard: EVERY team state renders a
// non-empty card (a thrown ReferenceError blanks the whole detail).

const KEYS_JS = readFileSync(path.resolve(__dirname, 'keys.js'), 'utf8');

// Stub the trusted-page environment and load keys.js, returning its render().
function mount({ teams = [], loadedKids = [], labels = {}, keyTeam = {}, pending = {}, reveal = 'SECRETKEY' } = {}) {
  document.body.innerHTML = '<div id="content"></div>';
  const loaded = new Set(loadedKids);
  const store = {
    karabuddyPrivateKeyLabels: { ...labels },
    karabuddyKeyTeam: { ...keyTeam },
    karabuddyPendingRotation: { ...pending },
  };
  const chrome = {
    runtime: {
      getURL: (p) => 'chrome-extension://test/' + (p || ''),
      sendMessage: (msg, cb) => {
        let res;
        switch (msg.type) {
          case 'listPrivateTeamKeyIds': res = { ok: true, data: [...loaded] }; break;
          case 'getTeamsMentionData': res = { ok: true, data: { ok: true, teams } }; break;
          case 'revealPrivateTeamKey': res = { ok: true, data: { key: reveal } }; break;
          case 'storePrivateTeamKey': loaded.add(msg.teamKeyId); res = { ok: true, data: {} }; break;
          case 'forgetPrivateTeamKey': loaded.delete(msg.teamKeyId); res = { ok: true, data: {} }; break;
          default: res = { ok: true, data: {} }; // enablePrivateMode, rotation*, etc.
        }
        Promise.resolve().then(() => cb(res));
      },
    },
    storage: {
      local: {
        get: async (k) => ({ [k]: store[k] }),
        set: async (obj) => { Object.assign(store, obj); },
      },
    },
  };
  globalThis.chrome = window.chrome = chrome;
  window.__KaraBuddy = { replays: { e2ee: {
    teamKeyId: async (key) => 'kid-' + key,
    generateTeamKey: async () => ({ key: 'FRESHKEY', teamKeyId: 'gen-kid' }),
  } } };
  if (!navigator.clipboard) navigator.clipboard = { writeText: async () => {} };

  // Capture render() rather than registering it, so repeated mounts don't pile up
  // DOMContentLoaded handlers (each mount is a fresh keys.js closure).
  let render;
  const origAdd = document.addEventListener.bind(document);
  document.addEventListener = (type, fn, ...rest) => { if (type === 'DOMContentLoaded') render = fn; else origAdd(type, fn, ...rest); };
  // eslint-disable-next-line no-eval
  (0, eval)(KEYS_JS);
  document.addEventListener = origAdd;
  return { render, store, loaded };
}

const content = () => document.getElementById('content');
const text = () => content().textContent;
const settle = async () => { for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0)); };
const buttons = () => [...content().querySelectorAll('button')];
const clickText = (t) => { const b = buttons().find((x) => x.textContent.trim() === t || x.textContent.includes(t)); if (!b) throw new Error(`no button "${t}" in: ${buttons().map((x) => x.textContent.trim()).join(' | ')}`); b.click(); };

afterEach(() => { delete window.__KaraBuddy; delete globalThis.chrome; delete window.chrome; });

// Four owners/members covering every detail state.
const TEAMS = {
  ready:       { slug: 'a', name: 'Alpha',   role: 'owner',  privateMode: true,  teamKeyId: 'kA' },
  needsKey:    { slug: 'b', name: 'Bravo',   role: 'member', privateMode: true,  teamKeyId: 'kB' },
  offNoKey:    { slug: 'c', name: 'Charlie', role: 'owner',  privateMode: false, teamKeyId: null },
  offHasKey:   { slug: 'd', name: 'Delta',   role: 'owner',  privateMode: false, teamKeyId: null },
};
const ALL = {
  teams: Object.values(TEAMS),
  loadedKids: ['kA', 'kD'],
  keyTeam: { kA: 'a', kD: 'd' },
  labels: { kA: 'Alpha', kD: 'Delta' },
};

async function openDetail(name) {
  clickText(name);
  await settle();
}

describe('master list', () => {
  it('lists every privacy-relevant team with the right status', async () => {
    const { render } = mount(ALL);
    await render();
    expect(text()).toContain('Your teams');
    for (const t of Object.values(TEAMS)) expect(text()).toContain(t.name);
    expect(text()).toContain('✓ Ready');                          // Alpha
    expect(text()).toContain('🔑 Needs key');                     // Bravo
    expect(text()).toContain('Not private');                       // Charlie
    expect(text()).toContain('Private mode off · key on this device'); // Delta
  });

  it('shows the unattached-keys bucket only for keys tied to no team', async () => {
    const { render } = mount({ ...ALL, loadedKids: ['kA', 'kD', 'stray'], keyTeam: { kA: 'a', kD: 'd' } });
    await render();
    expect(text()).toContain('Unattached keys');
    // A key grouped under one of my teams never shows up as unattached.
    const { render: r2 } = mount(ALL);
    await r2();
    expect(text()).not.toContain('Unattached keys');
  });
});

describe('team detail — every state renders a non-empty card (blank-page guard)', () => {
  for (const [state, t] of Object.entries(TEAMS)) {
    it(`renders a card for "${state}"`, async () => {
      const { render } = mount(ALL);
      await render();
      await openDetail(t.name);
      const card = content().querySelector('.card');
      expect(card, `no .card rendered for ${state}`).toBeTruthy();
      expect(card.childNodes.length).toBeGreaterThan(0);
      expect(text()).toContain(t.name);
    });
  }

  it('private + key loaded → Show key', async () => {
    const { render } = mount(ALL); await render(); await openDetail('Alpha');
    expect(text()).toContain('Team key');
    expect(buttons().some((b) => b.textContent.includes('Show key'))).toBe(true);
  });

  it('private + key missing → paste box (Add key)', async () => {
    const { render } = mount(ALL); await render(); await openDetail('Bravo');
    expect(buttons().some((b) => b.textContent.trim() === 'Add key')).toBe(true);
    expect(content().querySelector('input[type=password]')).toBeTruthy();
  });

  it('off + owner + no key → generate & enable', async () => {
    const { render } = mount(ALL); await render(); await openDetail('Charlie');
    expect(buttons().some((b) => b.textContent.includes('Generate key & turn on private mode'))).toBe(true);
  });

  it('off + owner + key on device → re-enable (reuses it) + Show key', async () => {
    const { render } = mount(ALL); await render(); await openDetail('Delta');
    expect(buttons().some((b) => b.textContent.includes('Re-enable private mode'))).toBe(true);
    expect(buttons().some((b) => b.textContent.includes('Show key'))).toBe(true);
  });
});

describe('Show key reveal', () => {
  it('reveals the stored key value on demand', async () => {
    const { render } = mount(ALL); await render(); await openDetail('Alpha');
    expect(text()).not.toContain('SECRETKEY');
    clickText('Show key');
    await settle();
    expect(text()).toContain('SECRETKEY');
  });
});

describe('rotation', () => {
  it('starting a rotation keeps Advanced open and reveals the new key to share', async () => {
    const { render, store } = mount(ALL); await render(); await openDetail('Alpha');
    clickText('Rotate key');        // inside Advanced (hidden, still clickable)
    await settle();
    expect(store.karabuddyPendingRotation.a).toBe('gen-kid');     // pending recorded
    expect(text()).toContain('rotation in progress');             // Advanced label flags it
    expect(text()).toContain('New key — rotating in');            // section visible (open)
    expect(text()).toContain('Run rotation');
    expect(text()).toContain('SECRETKEY');                        // new key auto-revealed
  });
});
