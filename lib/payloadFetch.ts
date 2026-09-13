// Isomorphic replay-payload reader (browser + Node, no server-only imports).
//
// B234 (storage cost): replay payloads are stored gzip-compressed. Depending on
// the store, the bytes a `fetch` yields are either
//   - already-decoded JSON text (Cloudflare R2 serves `Content-Encoding: gzip`,
//     which every browser + Node's undici transparently inflate), or
//   - raw gzip bytes (Vercel Blob can't attach a content-encoding, so the
//     browser hands us the compressed body as-is), or
//   - legacy plain JSON written before compression shipped.
// `decodePayloadBytes` sniffs the gzip magic and inflates via the platform's
// `DecompressionStream` (browsers, Node ≥ 18), so every reader is agnostic to
// which store / era the blob came from.

export function isGzipBytes(b: Uint8Array): boolean {
  return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
}

export async function decodePayloadBytes(bytes: Uint8Array): Promise<string> {
  if (!isGzipBytes(bytes)) return new TextDecoder().decode(bytes);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('gzip-compressed payload but DecompressionStream is unavailable');
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

// Fetch a payload blob URL and return its JSON text (inflated if needed).
export async function fetchPayloadText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`payload fetch failed: ${res.status}`);
  return decodePayloadBytes(new Uint8Array(await res.arrayBuffer()));
}

export async function fetchPayloadJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  return JSON.parse(await fetchPayloadText(url, init)) as T;
}
