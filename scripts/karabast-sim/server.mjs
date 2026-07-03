#!/usr/bin/env node
// B219: karabast-sim — a tiny, dependency-free fake karabast for validating
// the extension's transport-agnostic capture with a REAL unpacked extension.
//
//   npm run sim:karabast     (serves http://localhost:4517)
//
// Serves a harness page plus two "karabast" transports that replay the
// anonymized fixture game (scripts/karabast-sim/fixture.json):
//   - GET /karabast/poll?EIO=4&transport=polling&...   engine.io v4 polling:
//     \x1e-batched `42["gamestate",...]` packets — exercises the extension's
//     XHR/fetch polling interception (the B219 fix).
//   - WS  /karabast/ws?EIO=4&transport=websocket&...   raw WebSocket streaming
//     the same packets — exercises the original window.WebSocket proxy path.
//     `drop=1` destroys the socket mid-stream to simulate karabast yanking it.
// URLs contain "karabast" + engine.io params on purpose — that's what the
// extension's interceptors key on. The page at / drives scenarios and asserts
// against window.__KaraBuddy.replays.Recorder (same MAIN world).
//
// The extension must be loaded unpacked with the localhost:4517 dev host in
// manifest.json (stripped from published builds by package-extension.sh).
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.KARABAST_SIM_PORT || 4517);
const KARABUDDY_DEV = process.env.KARABUDDY_DEV_URL || 'http://localhost:3001';

// ---- Reconstruct the fixture's absolute states once at startup. ----
const fixture = JSON.parse(fs.readFileSync(path.join(DIR, 'fixture.json'), 'utf8'));
const setPath = (s, p, v) => {
  const parts = p.split('/');
  let o = s;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = v;
};
const states = [];
{
  let cur = null;
  for (const ev of fixture.events) {
    if (ev.full) cur = structuredClone(ev.full);
    else if (ev.patch) { for (const k of Object.keys(ev.patch)) setPath(cur, k, ev.patch[k]); }
    states.push(structuredClone(cur));
  }
}
console.log(`[sim] fixture: ${states.length} frames, final winners=${JSON.stringify(states[states.length - 1]?.winners)}`);

// One engine.io v4 MESSAGE packet carrying a socket.io EVENT: "42" + JSON.
// karabast sends the FULL gamestate on every push (the extension diffs), so we
// do the same: stamp the per-run gameId + a synthetic totalMessages (the B120
// merge key) + an empty newMessages onto each frame.
const packetFor = (i, gameId) =>
  '42' + JSON.stringify(['gamestate', { ...states[i], id: gameId, totalMessages: i, newMessages: [] }]);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  if (u.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(path.join(DIR, 'index.html')));
    return;
  }

  if (u.pathname === '/frames') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ frames: states.length }));
    return;
  }

  // Does /r/<slug> exist on the LOCAL karabuddy dev server? The extension's
  // upload result carries a RELATIVE url (`/r/<slug>`), so the page can't tell
  // where it landed from the string alone — this proxy checks the local dev
  // server directly (a slug minted by prod won't exist locally).
  if (u.pathname === '/karabuddy-check') {
    const slug = (u.searchParams.get('slug') || '').replace(/[^A-Za-z0-9_-]/g, '');
    try {
      const r = await fetch(`${KARABUDDY_DEV}/r/${slug}`, { signal: AbortSignal.timeout(4000) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ found: r.ok, endpoint: KARABUDDY_DEV }));
    } catch {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ found: false, endpoint: KARABUDDY_DEV }));
    }
    return;
  }

  // Server-side proxy so the page can show "karabuddy dev server up/down"
  // without cross-origin fiddling.
  if (u.pathname === '/karabuddy-status') {
    try {
      const r = await fetch(`${KARABUDDY_DEV}/api/extension/status?v=sim`, { signal: AbortSignal.timeout(1500) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ up: r.ok, endpoint: KARABUDDY_DEV }));
    } catch {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ up: false, endpoint: KARABUDDY_DEV }));
    }
    return;
  }

  // engine.io v4 long-polling: a batch of packets joined by \x1e.
  if (u.pathname === '/karabast/poll') {
    const gameId = u.searchParams.get('game') || 'sim-game';
    const from = clamp(parseInt(u.searchParams.get('from') || '0', 10), 0, states.length);
    const count = clamp(parseInt(u.searchParams.get('count') || '5', 10), 1, states.length);
    const to = Math.min(from + count, states.length);
    const packets = [];
    for (let i = from; i < to; i++) packets.push(packetFor(i, gameId));
    res.writeHead(200, { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' });
    res.end(packets.join('\x1e'));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

// ---- Minimal raw WebSocket server (server→client text frames only). ----
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const wsTextFrame = (str) => {
  const data = Buffer.from(str, 'utf8');
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x81, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
};

server.on('upgrade', (req, socket) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname !== '/karabast/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.on('data', () => {}); // drain client frames (close frames etc.) — unused
  socket.on('error', () => {});

  const gameId = u.searchParams.get('game') || 'sim-game';
  const from = clamp(parseInt(u.searchParams.get('from') || '0', 10), 0, states.length);
  const to = clamp(parseInt(u.searchParams.get('to') || String(states.length), 10), from, states.length);
  const intervalMs = clamp(parseInt(u.searchParams.get('intervalMs') || '120', 10), 10, 5000);
  const drop = u.searchParams.get('drop') === '1';

  let i = from;
  const timer = setInterval(() => {
    if (socket.destroyed) { clearInterval(timer); return; }
    if (i >= to) {
      clearInterval(timer);
      if (drop) {
        socket.destroy(); // abrupt: simulates karabast yanking the socket
      } else {
        socket.end(Buffer.from([0x88, 0x00])); // polite close frame
      }
      return;
    }
    try { socket.write(wsTextFrame(packetFor(i, gameId))); } catch { clearInterval(timer); }
    i++;
  }, intervalMs);
  socket.on('close', () => clearInterval(timer));
});

server.listen(PORT, () => {
  console.log(`[sim] karabast-sim up: http://localhost:${PORT}`);
  console.log(`[sim] karabuddy dev expected at ${KARABUDDY_DEV} (override: KARABUDDY_DEV_URL)`);
});
