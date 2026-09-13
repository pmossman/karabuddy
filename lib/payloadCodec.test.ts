import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { decodePayloadBytes, isGzipBytes } from './payloadFetch';
import { compressPayload, inflatePayload } from './blob';

// B234: payload compression round-trips across the server (zlib) and the
// browser-side reader (DecompressionStream), and legacy plain JSON still reads.
const sample = JSON.stringify({ version: 2, events: Array.from({ length: 200 }, (_, i) => ({ t: i, event: 'gamestate', args: [{ patch: { [`players/p${i % 2}/phase`]: 'action' } }] })) });

describe('payload codec', () => {
  it('server compressPayload → browser decodePayloadBytes round-trips', async () => {
    const bytes = compressPayload(sample);
    expect(isGzipBytes(bytes)).toBe(true);
    expect(bytes.length).toBeLessThan(sample.length / 5);
    expect(await decodePayloadBytes(new Uint8Array(bytes))).toBe(sample);
  });

  it('server inflatePayload reads gzip and plain text alike', () => {
    expect(inflatePayload(gzipSync(Buffer.from(sample)))).toBe(sample);
    expect(inflatePayload(Buffer.from(sample))).toBe(sample);
  });

  it('browser decoder passes plain (legacy / content-encoding-inflated) JSON through', async () => {
    expect(await decodePayloadBytes(new TextEncoder().encode(sample))).toBe(sample);
    expect(isGzipBytes(new TextEncoder().encode('{}'))).toBe(false);
  });
});
