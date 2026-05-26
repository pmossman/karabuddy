#!/usr/bin/env node
/*
 * Generates extension/icons/{16,48,128}.png from extension/icons/source-512.png.
 *
 * The source PNG is a screenshot of /tmp/karabuddy-icon-source.html captured
 * in headless Chrome so the rendering uses the real Barlow webfont loaded from
 * Google Fonts (matching the in-page launcher exactly). libvips' built-in font
 * rendering doesn't have Barlow installed locally, so we can't generate the
 * source from an inline SVG.
 *
 * To regenerate the source PNG: open /tmp/karabuddy-icon-source.html in Chrome
 * at viewport 512×512 and screenshot the full page into extension/icons/source-512.png.
 *
 * Run: node scripts/generate-icons.js  (or `npm run package:extension` which calls this)
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ICONS_DIR = path.join(__dirname, '..', 'extension', 'icons');
const SOURCE = path.join(ICONS_DIR, 'source-512.png');
const SIZES = [16, 48, 128];

(async () => {
  if (!fs.existsSync(SOURCE)) {
    console.error(`missing source: ${SOURCE}`);
    console.error('Re-capture it by opening /tmp/karabuddy-icon-source.html in Chrome at 512x512 and saving the screenshot here.');
    process.exit(1);
  }
  for (const size of SIZES) {
    const outPath = path.join(ICONS_DIR, `${size}.png`);
    await sharp(SOURCE)
      .resize(size, size, { kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toFile(outPath);
    console.log(`wrote ${outPath}`);
  }
})();
