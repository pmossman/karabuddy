#!/usr/bin/env node
/*
 * Renders extension/icons/{16,48,128}.png from an inline SVG so the icons
 * use the actual KARA/buddy brand typography (Barlow K + Georgia italic b
 * on a dark rounded-square) rather than the previous pixel-art placeholder.
 *
 * Sharp does the SVG → PNG raster via libvips. Composed once at 256px then
 * downsampled with lanczos3 for crisp output at every target size.
 *
 * Run:  node scripts/generate-icons.js
 *
 * Caveat: relies on Sharp/libvips font rendering. Barlow and Georgia may
 * fall back to system fonts on machines without them installed; the letter-
 * forms still read as the brand mark, just less polished. Swap in hand-
 * designed artwork before any Chrome Web Store submission.
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, '..', 'extension', 'icons');
const SIZES = [16, 48, 128];

// Mirrors the floating launcher button from extension/replays/05-footer.js
// at 6× scale (42px → 256px). Same gradient, same brand-blue border, same
// stacked KARA / buddy mark with the buddy indented + tucked tight under
// the KARA — so the installed extension icon reads identically to the
// in-page launcher.
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#243044"/>
      <stop offset="100%" stop-color="#1a1d23"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="256" height="256" rx="60" fill="url(#bg)"/>
  <rect x="3" y="3" width="250" height="250" rx="57" fill="none" stroke="#5a8cff" stroke-opacity="0.5" stroke-width="6"/>
  <g>
    <text x="30" y="132" font-family="'Barlow','Helvetica Neue',Arial,sans-serif" font-weight="400" font-size="72" fill="#ffffff" letter-spacing="0">KARA</text>
    <text x="66" y="198" font-family="Georgia,'Times New Roman',serif" font-style="italic" font-weight="700" font-size="60" fill="#5a8cff" letter-spacing="-0.5">buddy</text>
  </g>
</svg>
`.trim();

(async () => {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const outPath = path.join(OUT_DIR, `${size}.png`);
    await sharp(Buffer.from(SVG))
      .resize(size, size, { kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toFile(outPath);
    console.log(`wrote ${outPath}`);
  }
})();
