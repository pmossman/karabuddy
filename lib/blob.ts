// Vercel Blob wrapper with an in-memory test mode.
//
// Prod / dev: re-exports the real `put` from `@vercel/blob`.
// Test (KARABUDDY_BLOB_MODE=memory): stores writes in a process-local
// Map and returns a URL pointing at our test-only blob server route
// (`/api/test/blob/[...id]`) which reads back from the same Map.
// Lets the test suite exercise the full upload → store → viewer-fetch
// roundtrip without touching real Vercel infra.

import { put as vercelPut } from '@vercel/blob';

type PutFn = typeof vercelPut;

// Process-local store. Survives across requests because the dev server
// is a single Node process; tests run in the same process so they can
// also read directly via `getMemoryBlob` for assertions.
const memoryStore = new Map<string, string>();
// Records the options each write was made with, so tests can assert e.g. the
// cache TTL (which isn't observable from the stored body).
const memoryPutOptions = new Map<string, any>();

export function getMemoryBlob(pathname: string): string | undefined {
  return memoryStore.get(pathname);
}

export function getMemoryPutOptions(pathname: string): any {
  return memoryPutOptions.get(pathname);
}

export function clearMemoryBlobs(): void {
  memoryStore.clear();
  memoryPutOptions.clear();
}

const memoryPut: PutFn = async (pathname, body, options) => {
  const text = typeof body === 'string'
    ? body
    : body instanceof ArrayBuffer
      ? new TextDecoder().decode(new Uint8Array(body))
      : '';
  memoryStore.set(pathname, text);
  memoryPutOptions.set(pathname, options);
  const url = `${process.env.KARABUDDY_TEST_ORIGIN || 'http://localhost:3000'}/api/test/blob/${pathname}`;
  return {
    url,
    downloadUrl: url,
    pathname,
    contentType: 'application/json',
    contentDisposition: 'inline',
  } as any;
};

const useMemory = process.env.KARABUDDY_BLOB_MODE === 'memory';

export const put: PutFn = useMemory ? memoryPut : vercelPut;

// Read a stored payload back by its blob URL, server-side, in BOTH modes. In
// memory mode the URL points at our test-only blob route (unreachable from a
// route handler under test), so read the Map directly by the pathname encoded in
// the URL; in prod/dev fetch the URL. Returns null on any miss/failure.
export async function readBlobText(url: string): Promise<string | null> {
  if (useMemory) {
    const marker = '/api/test/blob/';
    const i = url.indexOf(marker);
    const pathname = i >= 0 ? url.slice(i + marker.length) : url;
    return memoryStore.get(pathname) ?? null;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
