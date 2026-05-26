#!/usr/bin/env node
/*
 * Generates extension/icons/{16,48,128}.png from the per-size 2× raw
 * screenshots in extension/icons/raw-{16,48,128}@2x.png.
 *
 * The raw PNGs are captured in headless Chrome from extension/icons/source.html
 * at viewport <size>×<size>×2 — so the browser does the layout pass at the
 * target's native pixel density and renders Barlow + Georgia properly from
 * Google Fonts. Sharp then downsamples 2× → 1× with lanczos3 supersampling
 * for an extra-crisp result at the canonical icon dimension.
 *
 * To re-capture the raw PNGs: open the source HTML in Chrome, set the
 * viewport to each target size × 2 DPR (e.g. 256×256, 96×96, 32×32),
 * screenshot the viewport into the matching raw file. See ICON-WORKFLOW.md
 * (or commit history) for the chrome-devtools MCP command sequence.
 *
 * Run: node scripts/generate-icons.js
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ICONS_DIR = path.join(__dirname, '..', 'extension', 'icons');
const SIZES = [16, 48, 128];

(async () => {
  for (const size of SIZES) {
    const src = path.join(ICONS_DIR, `raw-${size}@2x.png`);
    const out = path.join(ICONS_DIR, `${size}.png`);
    if (!fs.existsSync(src)) {
      console.error(`missing raw: ${src}`);
      process.exit(1);
    }
    await sharp(src)
      .resize(size, size, { kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toFile(out);
    console.log(`wrote ${out}`);
  }
})();
