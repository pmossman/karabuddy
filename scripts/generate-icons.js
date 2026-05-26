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

// Manifest detail: top-level `icons` declares only 128 because Chrome's
// extensions-page card picks the largest available size — leaving 48 in
// the map made Chrome serve the 48 PNG and upscale it fuzzily on retina.
// The toolbar action keeps the full 16/48/128 set since the toolbar slot
// really is tiny and benefits from a native 16.

// Rounded-rect alpha mask. The raw captures have an opaque page bg behind
// the rounded square, so the corners would show as white in Chrome's
// extension card otherwise. Mask shape mirrors the launcher's rounding:
// rx = size × (10 / 42) ≈ 23.8%.
const roundedMaskSvg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${size * 10 / 42}" fill="#ffffff"/>
</svg>
`.trim();

(async () => {
  for (const size of SIZES) {
    const src = path.join(ICONS_DIR, `raw-${size}@2x.png`);
    const out = path.join(ICONS_DIR, `${size}.png`);
    if (!fs.existsSync(src)) {
      console.error(`missing raw: ${src}`);
      process.exit(1);
    }
    // Two-stage pipeline: downsample the raw to the final output size first,
    // THEN composite the alpha mask. Sharp's automatic operation reordering
    // tries to compose resize-into-composite (more efficient) but that
    // compares the mask against the *post-resize* dimensions and rejects the
    // composite if the mask is larger. Materializing the resized buffer
    // breaks that optimization and is fine cost-wise at icon sizes.
    const resized = await sharp(src).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
    const mask = await sharp(Buffer.from(roundedMaskSvg(size)))
      .resize(size, size, { fit: 'fill' })
      .png()
      .toBuffer();
    await sharp(resized)
      .ensureAlpha()
      .composite([{ input: mask, blend: 'dest-in' }])
      .png({ compressionLevel: 9 })
      .toFile(out);
    console.log(`wrote ${out}`);
  }
})();
