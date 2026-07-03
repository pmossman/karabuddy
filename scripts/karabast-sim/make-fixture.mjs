#!/usr/bin/env node
// B219: build the karabast-sim fixture from a real .karareplay payload.
//
//   node scripts/karabast-sim/make-fixture.mjs <payload.json> [Old=New ...]
//
// Takes a recorded replay payload (the JSON stored in Vercel Blob / IDB),
// keeps ONLY the gamestate events (the {full}/{patch} sequence), and scrubs
// everything identifying so the fixture is safe to commit:
//   - newMessages (game log + player chat) dropped from the full state AND
//     from every patch (chat text is the most personal thing in a payload)
//   - spectators dropped
//   - the karabast game id replaced (the sim server stamps its own per run)
//   - usernames replaced via the Old=New args (global JSON-text replace, so
//     mentions inside nested structures are covered too)
// The sim server reconstructs absolute states from this and streams them to
// the extension over fake WS / engine.io-polling transports.
import fs from 'node:fs';
import path from 'node:path';

const [, , input, ...renames] = process.argv;
if (!input) {
  console.error('usage: make-fixture.mjs <payload.json> [OldName=NewName ...]');
  process.exit(1);
}
const payload = JSON.parse(fs.readFileSync(input, 'utf8'));
const events = (payload.events || []).filter((e) => e?.event === 'gamestate' && e?.args?.[0]);

const stripFull = (state) => {
  const s = structuredClone(state);
  delete s.newMessages;
  delete s.spectators;
  s.id = 'SIM_GAME_ID'; // stamped per run by the sim server
  return s;
};
const stripPatch = (patch) => {
  const out = {};
  for (const k of Object.keys(patch)) {
    if (k === 'newMessages' || k.startsWith('newMessages/')) continue;
    if (k === 'spectators' || k.startsWith('spectators/')) continue;
    if (k === 'id') continue;
    out[k] = patch[k];
  }
  return out;
};

const cleaned = [];
for (const e of events) {
  const a = e.args[0];
  if (a.full) cleaned.push({ full: stripFull(a.full) });
  else if (a.patch) {
    const p = stripPatch(a.patch);
    if (Object.keys(p).length > 0) cleaned.push({ patch: p });
  }
}

// Global text-level rename (usernames, lobby owner, anything else passed in).
let text = JSON.stringify({ note: 'karabast-sim fixture — anonymized gamestate sequence (B219)', events: cleaned });
for (const pair of renames) {
  const i = pair.indexOf('=');
  if (i < 1) continue;
  const from = pair.slice(0, i);
  const to = pair.slice(i + 1);
  text = text.split(from).join(to);
}

const outPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixture.json');
fs.writeFileSync(outPath, text);

// Sanity: reconstruct and report.
const fixture = JSON.parse(text);
const setPath = (s, p, v) => {
  const parts = p.split('/');
  let o = s;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = v;
};
let state = null;
let n = 0;
for (const ev of fixture.events) {
  if (ev.full) state = structuredClone(ev.full);
  else if (ev.patch) for (const k of Object.keys(ev.patch)) setPath(state, k, ev.patch[k]);
  n++;
}
const winners = state?.winners;
console.log(`fixture written: ${outPath}`);
console.log(`frames: ${n} | bytes: ${text.length} | final winners: ${JSON.stringify(winners)}`);
const leaks = renames.map((r) => r.split('=')[0]).filter((name) => text.includes(name));
console.log(leaks.length ? `WARNING — names still present: ${leaks}` : 'no renamed names remain ✓');
if (/newMessages/.test(text)) console.log('WARNING — newMessages still present');
