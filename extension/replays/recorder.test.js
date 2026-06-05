// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// B98 forward contract: the server's decoder, imported here so we can assert it
// understands the payload the CURRENT recorder produces. The frozen-0.5.0 e2e
// guards the reverse (server accepts OLD published shapes); this guards forward.
import { decodeReplay, extractWinners } from '@/lib/replayDecoder';

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

  it('captures Bo3 win-history (game number + score-before-this-game) into payload.match', async () => {
    const { uploads } = setup();
    const ws = new window.WebSocket('wss://api.karabast.net/socket');
    // Game 2 of a Bo3, score 1-0 going in (p1 won game 1).
    ws.recv(sio('lobbystate', { gameFormat: 'premier', winHistory: { gamesToWinMode: 'bestOfThree', currentGameNumber: 2, winsPerPlayer: { p1: 1, p2: 0 }, setEndResult: null } }));
    ws.recv(sio('gamestate', gs('g2', 'p1')));
    for (let i = 0; i < 10; i++) ws.recv(sio('gamestate', gs('g2', i % 2 === 0 ? 'p2' : 'p1')));
    ws.recv(sio('gamestate', gs('g2', 'p1', { gameOver: true })));
    await vi.advanceTimersByTimeAsync(1500);
    expect(uploads[0].match.winHistory).toEqual({ currentGameNumber: 2, winsPerPlayer: { p1: 1, p2: 0 }, setEndResult: null });
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

// FORWARD CONTRACT (B98): a breaking recorder wire change must fail CI before
// the extension is ever submitted to CWS. We drive the REAL recorder, then feed
// its exact output to the REAL server decoder (lib/replayDecoder) and assert it
// still extracts everything the app relies on. If the recorder's payload shape
// drifts from what the server understands, this goes red here — no longer
// relying on remembering the two-sided-compat rule at submit time.
describe('forward contract: server decodes the current recorder payload', () => {
  it('decodeReplay extracts frames / POV / match / winner / tags from real recorder output', async () => {
    const { R, uploads } = setup();
    const ws = new window.WebSocket('wss://api.karabast.net/socket');
    ws.recv(sio('lobbystate', { gameFormat: 'premier', cardPool: 'unlimited', winHistory: { gamesToWinMode: 'bestOfThree' }, lobbyName: 'L' }));
    ws.recv(sio('gamestate', gs('g1', 'p1')));
    for (let i = 0; i < 10; i++) ws.recv(sio('gamestate', gs('g1', i % 2 === 0 ? 'p2' : 'p1')));
    R.addTag('forward contract tag');
    ws.recv(sio('gamestate', gs('g1', 'p2', { gameOver: true, winners: ['Alice'] })));
    await vi.advanceTimersByTimeAsync(1500);
    expect(uploads).toHaveLength(1);

    // The server consumes the parsed payload object the recorder uploads.
    const decoded = decodeReplay(uploads[0]);
    expect(decoded.meta.version).toBe(2);
    expect(decoded.meta.localPlayerId).toBe('p1'); // POV detection survives the round-trip
    expect(decoded.frames.length).toBeGreaterThan(0); // events were recognized as gamestate frames
    expect(decoded.meta.match?.gameFormat).toBe('premier'); // lobby meta decoded
    expect(decoded.tags.map((t) => t.comment)).toContain('forward contract tag');

    // Winner-by-username ('Alice') still resolves to a playerId the server understands.
    const finalState = decoded.frames[decoded.frames.length - 1].state;
    expect(extractWinners(finalState)).toContain('p1');
  });

  it('a choice menu the recorder faced survives recorder → server decode (B105)', async () => {
    const { uploads } = setup();
    const ws = new window.WebSocket('wss://api.karabast.net/socket');
    // Build frames where p1 (recorder) is shown a prompt on one of them.
    const promptGs = (active, ps) => ({
      id: 'g1',
      players: {
        p1: { user: { username: 'Alice' }, cardPiles: { hand: [{ id: 'SOR_001', setId: { set: 'SOR', number: 1 } }] }, isActionPhaseActivePlayer: active === 'p1', promptState: ps },
        p2: { user: { username: 'Bob' }, cardPiles: { hand: [{ controllerId: 'p2' }] }, isActionPhaseActivePlayer: active === 'p2' },
      },
    });
    ws.recv(sio('gamestate', promptGs('p1', null)));
    ws.recv(sio('gamestate', promptGs('p1', { menuTitle: 'Choose a target', buttons: [{ text: 'Cancel', arg: 'cancel' }], displayCards: [{ id: 'SOR_050' }] })));
    for (let i = 0; i < 10; i++) ws.recv(sio('gamestate', promptGs(i % 2 === 0 ? 'p2' : 'p1', null)));
    ws.recv(sio('gamestate', { id: 'g1', gameOver: true, winners: ['Alice'], players: promptGs('p2', null).players }));
    await vi.advanceTimersByTimeAsync(1500);

    const decoded = decodeReplay(uploads[0]);
    const prompted = decoded.frames.find((f) => f.state.players?.p1?.promptState?.menuTitle === 'Choose a target');
    expect(prompted).toBeTruthy();
    expect(prompted.state.players.p1.promptState.buttons).toEqual([{ text: 'Cancel', arg: 'cancel' }]);
    // And a later non-prompt frame has reset back to empty (no sticky prompt).
    const last = decoded.frames[decoded.frames.length - 1].state;
    expect(last.players.p1.promptState.menuTitle).toBe('');
  });
});
