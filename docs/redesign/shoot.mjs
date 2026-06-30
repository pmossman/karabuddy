// Reusable screenshot harness for the viewer redesign (B216).
//
// Usage:
//   node docs/redesign/shoot.mjs <slug> <ownerEmail> <label> [querySuffix] [openSel]
// e.g.
//   node docs/redesign/shoot.mjs r_euxnsk user162@example.com baseline ""
//   node docs/redesign/shoot.mjs r_euxnsk user162@example.com v2-tags "?redesign=1"
//
// - Signs in as <ownerEmail> via /api/test/sign-in (dev server must run with
//   KARABUDDY_TEST_API=1). The replay OWNER sees all tags (B131), so the tag
//   panel is fully populated for design work.
// - Screenshots the viewer at 4 aspect ratios into docs/redesign/shots/.
// - If [openSel] is given, clicks it on each page first (e.g. to open a panel).
//
// Read the PNGs back with the Read tool to self-verify layout.

import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3006';
const [, , slug, email, label = 'shot', suffix = '', openSel = '', only = ''] = process.argv;
if (!slug || !email) { console.error('usage: node shoot.mjs <slug> <ownerEmail> <label> [querySuffix] [openSel] [onlyViewportsCSV]'); process.exit(1); }

const ALL = [
  { name: 'mobile-portrait', width: 390, height: 844 },
  { name: 'mobile-landscape', width: 844, height: 390 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];
const VIEWPORTS = only ? ALL.filter((v) => only.split(',').includes(v.name)) : ALL;

const res = await fetch(`${BASE}/api/test/sign-in`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
});
const auth = await res.json();
if (!auth.ok) { console.error('sign-in failed:', auth); process.exit(1); }
console.log('signed in as', email, '→', auth.userId);

const browser = await chromium.launch();
const outDir = new URL('./shots/', import.meta.url).pathname;
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: auth.cookieName, value: auth.cookieValue, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/r/${slug}${suffix}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3500); // board decode + render
  // Optional: advance frames (STEPS=N env) so frame-dependent features (Game Log)
  // have content. ArrowRight steps the viewer.
  const steps = Number(process.env.STEPS || 0);
  for (let s = 0; s < steps; s++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(40); }
  if (steps) await page.waitForTimeout(500);
  // openSel may be several selectors separated by '|', clicked in sequence
  // (e.g. open the panel, then open the composer).
  for (const sel of openSel.split('|').map((s) => s.trim()).filter(Boolean)) {
    try { await page.click(sel, { timeout: 3000 }); await page.waitForTimeout(700); } catch (e) { console.warn('click miss:', sel, e.message); }
  }
  const file = `${outDir}${label}-${vp.name}.png`;
  await page.screenshot({ path: file });
  console.log('shot:', file.split('/').slice(-1)[0]);
  await ctx.close();
}
await browser.close();
console.log('done.');
