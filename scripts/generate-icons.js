#!/usr/bin/env node
/*
 * Generates extension/icons/{16,48,128}.png — placeholder app icons.
 * Dark square (#11141a) with a brand-blue (#5a8cff) "Kb" rendered from a
 * small bitmap font, scaled up by nearest-neighbour for each size.
 *
 * Uses only Node built-ins (zlib, fs, crypto). No external deps.
 * Re-run any time you want to regenerate the placeholders. Replace with
 * polished artwork before Chrome Web Store submission.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// --- Tiny PNG encoder (truecolor + alpha, 8-bit) ----------------------
function crc32(buf) {
  let c;
  const table = crc32._t || (crc32._t = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // truecolor + alpha
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // One filter byte (0 = None) per scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Logo bitmap ------------------------------------------------------
// 16x16 grid. '#' = brand blue, '.' = background.
// Approximate "Kb" monogram — readable at 16, looks fine scaled to 128.
const LOGO = [
  '................',
  '................',
  '..#...#.........',
  '..#..#..#.......',
  '..#.#...#.......',
  '..##....####....',
  '..##....#...#...',
  '..##....#...#...',
  '..#.#...#...#...',
  '..#..#..####....',
  '..#...#.........',
  '..#...#.........',
  '................',
  '................',
  '................',
  '................',
];

const BG = [0x11, 0x14, 0x1a, 0xff];      // #11141a (matches site dark)
const FG = [0x5a, 0x8c, 0xff, 0xff];      // #5a8cff (brand blue)

function renderSquare(size) {
  const rgba = Buffer.alloc(size * size * 4);
  // Fill background.
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4 + 0] = BG[0];
    rgba[i * 4 + 1] = BG[1];
    rgba[i * 4 + 2] = BG[2];
    rgba[i * 4 + 3] = BG[3];
  }
  // Nearest-neighbour scale the 16x16 logo up to `size`.
  const src = LOGO.length;
  const scale = size / src;
  for (let y = 0; y < size; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < size; x++) {
      const sx = Math.floor(x / scale);
      if (LOGO[sy][sx] === '#') {
        const i = (y * size + x) * 4;
        rgba[i + 0] = FG[0];
        rgba[i + 1] = FG[1];
        rgba[i + 2] = FG[2];
        rgba[i + 3] = FG[3];
      }
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = path.resolve(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const buf = renderSquare(size);
  const file = path.join(outDir, `${size}.png`);
  fs.writeFileSync(file, buf);
  console.log(`wrote ${file} (${buf.length} bytes)`);
}
