// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// B80: end-to-end harness for the REAL recorder. The recorder's only entry
// point is a window.WebSocket proxy (it intercepts karabast's socket); this
// drives a synthetic match through that exact path — frames → parse → record →
// game-end → auto-finalize → bridge.uploadReplay — and asserts the produced
// payload. This is the data-capture heart of the product; a regression here
// silently loses games, and it was previously only "eyeball"-tested.

function evalFile(name) {
  const code = readFileSync(path.resolve(__dirname, name), 'utf8');
  // eslint-disable-next-line no-eval
  (0, eval)(code);
}

// Minimal stand-in for karabast's WebSocket — constructable (the recorder's
// proxy does Reflect.construct on it) + an EventTarget so addEventListener
// works, plus recv() to push an inbound frame.
class FakeSocket extends EventTarget {
  constructor(url) { super(); this.url = url; }
  send() {}
  recv(data) { this.dispatchEvent(new MessageEvent('message', { data })); }
}

// socket.io event frame: engine.io '4' + sio '2' + JSON array.
const sio = (event, payload) => '42' + JSON.stringify([event, payload]);

// A gamestate where exactly one player is the action-phase active player.
// p1 has a visible hand (id) → the recorder's POV; p2's is masked (stub).
const gs = (id, active, extra = {}) => ({
  id,
  players: {
    p1: { user: { username: 'Alice' }, cardPiles: { hand: [{ id: 'SOR_001', setId: { set: 'SOR', number: 1 } }] }, isActionPhaseActivePlayer: active === 'p1' },
    p2: { user: { username: 'Bob' }, cardPiles: { hand: [{ controllerId: 'p2' }] }, isActionPhaseActivePlayer: active === 'p2' },
  },
  ...extra,
});

function setup({ minUploadActions } = {}) {
  window.WebSocket = FakeSocket; // reset before the proxy wraps it (avoid stacking proxies across tests)
  evalFile('01-namespace.js'); // defines NS.dlog + the real bridge (overridden below)
  evalFile('00-karabast-shape.js'); // defines validateKarabastGamestate/structuralIssueCodes (drift rule)
  evalFile('02-decoder.js');
  const uploads = [];
  const beacons = [];
  const NS = window.__KaraBuddy.replays;
  NS.bridge = {
    uploadReplay: (text) => { uploads.push(JSON.parse(text)); return Promise.resolve({ slug: 's', url: '/r/s' }); },
    saveReplay: () => Promise.resolve(),
    applyTeamShares: () => Promise.resolve(),
    getUserSettings: () => Promise.resolve(minUploadActions != null ? { ok: true, minUploadActions } : null),
    reportHealth: (issues) => { beacons.push(issues); return Promise.resolve({ ok: true }); },
  };
  NS.Footer = { refreshOverlay() {}, refreshReplayBrowser() {}, getShareTeamSlugs: () => [] };
  NS.toast = { show() {} };
  evalFile('03-recorder.js');
  return { R: NS.Recorder, uploads, beacons };
}

// Drive a full game (each player acts well past the default 5-action gate),
// then a game-end frame. Returns once the 1.5s auto-finalize timer fires.
async function playFullMatch(extraEndFields = {}) {
  const ws = new window.WebSocket('wss://api.karabast.net/socket');
  ws.recv(sio('gamestate', gs('g1', 'p1')));                 // p1 acts (1)
  for (let i = 0; i < 10; i++) ws.recv(sio('gamestate', gs('g1', i % 2 === 0 ? 'p2' : 'p1'))); // 5 + 5
  ws.recv(sio('gamestate', gs('g1', 'p2', { gameOver: true, winners: ['Alice'], ...extraEndFields }))); // game end
  await vi.advanceTimersByTimeAsync(1500); // scheduleAutoDownload → download('auto')
  return ws;
}

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); delete window.__KaraBuddy; });

describe('recorder end-to-end (WebSocket → payload)', () => {
  it('captures a full match and uploads a well-formed payload on game-end', async () => {
    const { uploads } = setup();
    await playFullMatch();

    expect(uploads).toHaveLength(1);
    const p = uploads[0];
    expect(p.version).toBe(2);
    expect(Array.isArray(p.events)).toBe(true);
    // First event is the {full} seed carrying the gameId; the rest are {patch}.
    const firstFull = p.events.find((e) => e.args?.[0]?.full);
    expect(firstFull.args[0].full.id).toBe('g1');
    expect(p.events.filter((e) => e.args?.[0]?.patch).length).toBeGreaterThan(0);
  });

  it('detects the local player (POV) from the hand-visibility asymmetry', async () => {
    const { uploads } = setup();
    await playFullMatch();
    expect(uploads[0].localPlayerId).toBe('p1'); // p1 had the visible hand
  });

  it('does NOT upload a sub-threshold match (rage-quit guard)', async () => {
    const { uploads } = setup();
    const ws = new window.WebSocket('wss://api.karabast.net/socket');
    ws.recv(sio('gamestate', gs('g1', 'p1')));
    ws.recv(sio('gamestate', gs('g1', 'p2')));
    ws.recv(sio('gamestate', gs('g1', 'p1', { gameOver: true })));
    await vi.advanceTimersByTimeAsync(1500);
    expect(uploads).toHaveLength(0); // each player acted < 5 times
  });

  it('freezes lobby metadata seen before the first gamestate into payload.match', async () => {
    const { uploads } = setup();
    const ws = new window.WebSocket('wss://api.karabast.net/socket');
    ws.recv(sio('lobbystate', { gameFormat: 'premier', cardPool: 'unlimited', winHistory: { gamesToWinMode: 'bestOfThree' }, lobbyName: 'L' }));
    ws.recv(sio('gamestate', gs('g1', 'p1')));
    for (let i = 0; i < 10; i++) ws.recv(sio('gamestate', gs('g1', i % 2 === 0 ? 'p2' : 'p1')));
    ws.recv(sio('gamestate', gs('g1', 'p2', { gameOver: true })));
    await vi.advanceTimersByTimeAsync(1500);
    expect(uploads[0].match.gameFormat).toBe('premier');
    expect(uploads[0].match.gamesToWinMode).toBe('bestOfThree');
  });

  it('fires a content-free drift beacon when karabast gamestate shape drifts', async () => {
    const { beacons } = setup();
    const ws = new window.WebSocket('wss://api.karabast.net/socket');
    // First frame has a leader with no setId — a structural drift our pipeline
    // depends on (card art / matchup). p2 hand masked as usual.
    ws.recv(sio('gamestate', {
      id: 'g1',
      players: {
        p1: { user: { username: 'Alice' }, isActionPhaseActivePlayer: true, leader: { name: 'L' }, cardPiles: { hand: [{ id: 'SOR_010', setId: { set: 'SOR', number: 10 } }] } },
        p2: { user: { username: 'Bob' }, cardPiles: { hand: [{ controllerId: 'p2' }] } },
      },
    }));
    expect(beacons).toHaveLength(1);
    expect(beacons[0]).toContain('leader_no_setid'); // a fixed enum code, no game data
  });

  it('does NOT beacon on a healthy match (silent in steady state)', async () => {
    const { beacons } = setup();
    const ws = new window.WebSocket('wss://api.karabast.net/socket');
    ws.recv(sio('gamestate', gs('g1', 'p1')));
    for (let i = 0; i < 4; i++) ws.recv(sio('gamestate', gs('g1', i % 2 === 0 ? 'p2' : 'p1')));
    expect(beacons).toHaveLength(0);
  });

  it('includes in-game tags (authored as the local player) in the payload', async () => {
    const { R, uploads } = setup();
    const ws = new window.WebSocket('wss://api.karabast.net/socket');
    ws.recv(sio('gamestate', gs('g1', 'p1')));
    for (let i = 0; i < 10; i++) ws.recv(sio('gamestate', gs('g1', i % 2 === 0 ? 'p2' : 'p1')));
    R.addTag('great line here');
    ws.recv(sio('gamestate', gs('g1', 'p2', { gameOver: true })));
    await vi.advanceTimersByTimeAsync(1500);

    expect(uploads[0].tags).toHaveLength(1);
    expect(uploads[0].tags[0].comment).toBe('great line here');
    expect(uploads[0].tags[0].author).toBe('Alice'); // local player, not iteration order
  });
});
