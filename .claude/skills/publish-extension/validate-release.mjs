#!/usr/bin/env node
// Pre-submission validator for a Chrome Web Store publication of the KaraBuddy
// extension. Run AFTER `npm run package:extension` so it can inspect the
// PACKAGED manifest (package-extension.sh strips the dev-only localhost /
// *.vercel.app hosts — the store reviewer only ever sees the stripped set, so
// that's what the listing justifications must match).
//
// Checks, all offline (no network, no sips/imagemagick — PNG dims are read
// straight from the IHDR header):
//   1. A dist zip exists; its manifest version matches extension/manifest.json.
//   2. Every permission + host_permission in the PACKAGED manifest has a
//      justification section in docs/chrome-web-store-listing.md.
//   3. Short description ≤ 132 chars (the CWS search-result line).
//   4. Required listing assets exist at the right pixel dimensions
//      (store icon 128², screenshots 1280×800 or 640×400). Promo tiles warn.
//   5. Every assets/store/* and scripts/* path the listing doc references
//      actually exists (catches stale filenames like icon-128.png).
//
// Exit 0 = ready to submit. Exit 1 = fix the FAILs first. Usage:
//   node .claude/skills/publish-extension/validate-release.mjs

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fails = [];
const warns = [];
const oks = [];
const fail = (m) => fails.push(m);
const warn = (m) => warns.push(m);
const ok = (m) => oks.push(m);

const rel = (p) => join(ROOT, p);
const read = (p) => readFileSync(rel(p), 'utf8');

// --- PNG dimensions from the IHDR header (width@16, height@20, big-endian) ---
function pngSize(absPath) {
  const buf = readFileSync(absPath);
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// --- 1. locate the packaged zip + read its manifest --------------------------
let packaged = null;
let zipName = null;
try {
  const zips = readdirSync(rel('dist')).filter((f) => /^karabuddy-extension-.*\.zip$/.test(f));
  if (zips.length === 0) throw new Error('no zip');
  // newest by mtime
  zipName = zips
    .map((f) => ({ f, m: statSync(rel('dist/' + f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0].f;
  const manifestText = execSync(`unzip -p ${JSON.stringify(rel('dist/' + zipName))} manifest.json`).toString();
  packaged = JSON.parse(manifestText);
  ok(`packaged zip: dist/${zipName} (manifest v${packaged.version})`);
} catch {
  fail('No dist/karabuddy-extension-*.zip found — run `npm run package:extension` first.');
}

if (packaged) {
  const src = JSON.parse(read('extension/manifest.json'));
  if (src.version !== packaged.version) {
    fail(`version mismatch: source manifest v${src.version} vs packaged v${packaged.version} (rebuild the zip).`);
  } else {
    ok(`version consistent (source = packaged = v${src.version})`);
  }
}

// --- 2. permissions ⊆ justifications -----------------------------------------
const listing = read('docs/chrome-web-store-listing.md');
const justStart = listing.indexOf('## Permissions justifications');
const justSection = justStart >= 0 ? listing.slice(justStart, listing.indexOf('\n## ', justStart + 5)) : '';
if (!justSection) {
  fail('docs/chrome-web-store-listing.md is missing the "## Permissions justifications" section.');
} else if (packaged) {
  const perms = packaged.permissions || [];
  const hosts = packaged.host_permissions || [];
  for (const p of perms) {
    if (justSection.includes('`' + p + '`')) ok(`permission "${p}" is justified`);
    else fail(`permission "${p}" has NO justification in the listing doc.`);
  }
  for (const h of hosts) {
    if (justSection.includes(h)) ok(`host "${h}" is justified`);
    else fail(`host_permission "${h}" has NO justification in the listing doc (reviewer red flag).`);
  }
  // Reverse sanity: dev hosts must NOT survive into the packaged manifest.
  for (const h of hosts) {
    if (/localhost|vercel\.app/.test(h)) fail(`packaged manifest still contains dev host "${h}" — packaging strip failed.`);
  }
}

// --- 3. short description ≤ 132 ----------------------------------------------
{
  const idx = listing.search(/short description/i);
  if (idx < 0) {
    warn('could not find the "Short description" field in the listing doc.');
  } else {
    const fence = listing.slice(idx).match(/```([\s\S]*?)```/);
    const text = fence ? fence[1].trim() : '';
    if (!text) warn('short description code-block looks empty.');
    else if (text.length > 132) fail(`short description is ${text.length} chars (max 132): "${text.slice(0, 50)}…"`);
    else ok(`short description ${text.length}/132 chars`);
  }
}

// --- 4. listing assets at correct dimensions ---------------------------------
function checkPng(path, wantW, wantH, { required } = { required: true }) {
  const abs = rel(path);
  if (!existsSync(abs)) {
    (required ? fail : warn)(`${path} is missing${required ? '' : ' (optional)'}.`);
    return;
  }
  const s = pngSize(abs);
  if (!s) { fail(`${path} is not a readable PNG.`); return; }
  if (s.w !== wantW || s.h !== wantH) fail(`${path} is ${s.w}×${s.h}, expected ${wantW}×${wantH}.`);
  else ok(`${path} ${s.w}×${s.h}`);
}

checkPng('assets/store/store-icon-128.png', 128, 128);
{
  const shots = existsSync(rel('assets/store'))
    ? readdirSync(rel('assets/store')).filter((f) => /^screenshot-.*\.png$/.test(f))
    : [];
  if (shots.length === 0) fail('no assets/store/screenshot-*.png found (CWS needs at least one).');
  else if (shots.length > 5) warn(`${shots.length} screenshots — CWS shows at most 5.`);
  for (const f of shots) {
    const s = pngSize(rel('assets/store/' + f));
    if (!s) { fail(`assets/store/${f} unreadable.`); continue; }
    const sizeOk = (s.w === 1280 && s.h === 800) || (s.w === 640 && s.h === 400);
    if (sizeOk) ok(`assets/store/${f} ${s.w}×${s.h}`);
    else fail(`assets/store/${f} is ${s.w}×${s.h}, expected 1280×800 or 640×400.`);
  }
}
// Promo tiles are optional (only the small tile is commonly needed) → warn.
checkPng('assets/store/promo-440x280.png', 440, 280, { required: false });
checkPng('assets/store/promo-920x680.png', 920, 680, { required: false });
checkPng('assets/store/promo-1400x560.png', 1400, 560, { required: false });

// --- 5. every script path the doc references actually exists -----------------
// (Asset PNGs are covered by the dimension checks above; here we only catch
// stale script references like a generate-screenshots.sh that doesn't exist.)
{
  const refs = new Set();
  for (const m of listing.matchAll(/scripts\/[A-Za-z0-9._-]+\.[a-z]+/g)) refs.add(m[0]);
  for (const p of refs) {
    if (existsSync(rel(p))) ok(`doc reference exists: ${p}`);
    else warn(`listing doc references ${p}, which does not exist (stale path?).`);
  }
}

// --- report ------------------------------------------------------------------
const line = '─'.repeat(64);
console.log(line);
console.log('Chrome Web Store pre-submission validation');
console.log(line);
for (const m of oks) console.log('  ✓ ' + m);
for (const m of warns) console.log('  ⚠ ' + m);
for (const m of fails) console.log('  ✗ ' + m);
console.log(line);
if (fails.length) {
  console.log(`✗ ${fails.length} blocker(s), ${warns.length} warning(s). Fix the blockers before submitting.`);
  process.exit(1);
}
console.log(`✓ Ready to submit. ${warns.length} warning(s) to review.`);
