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

export function getMemoryBlob(pathname: string): string | undefined {
  return memoryStore.get(pathname);
}

export function clearMemoryBlobs(): void {
  memoryStore.clear();
}

const memoryPut: PutFn = async (pathname, body) => {
  const text = typeof body === 'string'
    ? body
    : body instanceof ArrayBuffer
      ? new TextDecoder().decode(new Uint8Array(body))
      : '';
  memoryStore.set(pathname, text);
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
