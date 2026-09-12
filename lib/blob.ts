// Replay payload storage (server-only).
//
// B234 (storage cost): every payload is gzip-compressed before it's written
// (~24x smaller than the raw JSON — a typical 320 kB game stores as ~13 kB) and
// transparently inflated on read (`readBlobText`). Three drivers, picked by env:
//
//   memory  KARABUDDY_BLOB_MODE=memory — process-local Map, test suites only.
//           Writes land in the Map and the URL points at the test-only
//           `/api/test/blob/[...id]` route, which serves the stored bytes so the
//           browser-side decode path is exercised end to end.
//   s3      KARABUDDY_BLOB_DRIVER=s3 — any S3-compatible bucket, meant for
//           Cloudflare R2 (free tier: 10 GB + 1M writes/month, zero egress; the
//           same setup swuforge uses). Objects carry `Content-Encoding: gzip`, so
//           browsers inflate natively. Needs R2_ACCOUNT_ID (or R2_ENDPOINT),
//           R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and
//           R2_PUBLIC_BASE_URL (the bucket's public r2.dev / custom domain).
//   vercel  default — Vercel Blob. Can't attach a content-encoding, so readers
//           sniff the gzip magic (lib/payloadFetch.ts).
//
// Payload URLs are stored per replay row, so the drivers can coexist: reads and
// deletes route by URL, and scripts/migrate-payloads.ts moves rows across.

import { put as vercelPut, del as vercelDel } from '@vercel/blob';
import { gzipSync, gunzipSync } from 'node:zlib';
import { isGzipBytes } from './payloadFetch';

export type BlobDriver = 'memory' | 's3' | 'vercel';

export interface PutPayloadOptions {
  // Browser/CDN cache TTL. Payload blobs are overwritten in place as a game
  // streams in, so callers pass a short TTL (see app/api/replays/route.ts).
  cacheControlMaxAge?: number;
}

export interface PutPayloadResult {
  url: string;
  pathname: string;
  // Bytes actually stored (compressed).
  storedBytes: number;
  encoding: 'gzip';
}

// ----- driver selection -----

interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string; // no trailing slash
}

function readS3Config(): S3Config | null {
  if (process.env.KARABUDDY_BLOB_DRIVER !== 's3') return null;
  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    throw new Error('KARABUDDY_BLOB_DRIVER=s3 needs R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL');
  }
  return { endpoint, region: process.env.R2_REGION || 'auto', accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

const useMemory = process.env.KARABUDDY_BLOB_MODE === 'memory';
const s3Config = useMemory ? null : readS3Config();

export function blobDriver(): BlobDriver {
  return useMemory ? 'memory' : s3Config ? 's3' : 'vercel';
}

// ----- compression -----

export function compressPayload(text: string): Buffer {
  return gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
}

export function inflatePayload(bytes: Uint8Array): string {
  return isGzipBytes(bytes) ? gunzipSync(bytes).toString('utf8') : Buffer.from(bytes).toString('utf8');
}

// ----- memory driver (tests) -----

// Process-local store. Survives across requests because the dev server is a
// single Node process; tests run in the same process so they can also read
// directly via `getMemoryBlob` for assertions.
const memoryStore = new Map<string, Uint8Array>();
// Records the options each write was made with, so tests can assert e.g. the
// cache TTL (which isn't observable from the stored body).
const memoryPutOptions = new Map<string, any>();

// Decoded (inflated) text — what tests want to JSON.parse.
export function getMemoryBlob(pathname: string): string | undefined {
  const bytes = memoryStore.get(pathname);
  return bytes === undefined ? undefined : inflatePayload(bytes);
}

// Raw stored bytes — what the test blob route serves, so the browser path
// really does inflate.
export function getMemoryBlobBytes(pathname: string): Uint8Array | undefined {
  return memoryStore.get(pathname);
}

export function getMemoryPutOptions(pathname: string): any {
  return memoryPutOptions.get(pathname);
}

export function clearMemoryBlobs(): void {
  memoryStore.clear();
  memoryPutOptions.clear();
}

function memoryUrl(pathname: string): string {
  return `${process.env.KARABUDDY_TEST_ORIGIN || 'http://localhost:3000'}/api/test/blob/${pathname}`;
}

const MEMORY_MARKER = '/api/test/blob/';
function memoryPathname(url: string): string {
  const i = url.indexOf(MEMORY_MARKER);
  return i >= 0 ? url.slice(i + MEMORY_MARKER.length) : url;
}

// ----- s3 driver (Cloudflare R2) -----

let s3Client: import('@aws-sdk/client-s3').S3Client | null = null;
async function s3(): Promise<import('@aws-sdk/client-s3').S3Client> {
  if (s3Client) return s3Client;
  const { S3Client } = await import('@aws-sdk/client-s3');
  const cfg = s3Config!;
  s3Client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: true,
  });
  return s3Client;
}

function s3KeyForUrl(url: string): string | null {
  if (!s3Config) return null;
  const base = s3Config.publicBaseUrl + '/';
  return url.startsWith(base) ? decodeURIComponent(url.slice(base.length)) : null;
}

// ----- public API -----

// Write a replay payload (JSON text) at a stable pathname, overwriting any
// previous object there. Returns the public URL to store on the replay row.
export async function putPayload(pathname: string, text: string, options: PutPayloadOptions = {}): Promise<PutPayloadResult> {
  const body = compressPayload(text);
  const cacheControlMaxAge = options.cacheControlMaxAge;

  if (useMemory) {
    memoryStore.set(pathname, body);
    memoryPutOptions.set(pathname, { ...options, contentType: 'application/json', contentEncoding: 'gzip' });
    return { url: memoryUrl(pathname), pathname, storedBytes: body.length, encoding: 'gzip' };
  }

  if (s3Config) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await s3()).send(new PutObjectCommand({
      Bucket: s3Config.bucket,
      Key: pathname,
      Body: body,
      ContentType: 'application/json',
      ContentEncoding: 'gzip',
      ...(cacheControlMaxAge != null ? { CacheControl: `public, max-age=${cacheControlMaxAge}` } : {}),
    }));
    return { url: `${s3Config.publicBaseUrl}/${pathname}`, pathname, storedBytes: body.length, encoding: 'gzip' };
  }

  // Vercel Blob. `addRandomSuffix: false` pins the path; in @vercel/blob 0.27.x
  // that silently overwrites an existing blob at the same path. The body is
  // gzip bytes with no content-encoding (not supported) — readers sniff it.
  const blob = await vercelPut(pathname, body, {
    access: 'public',
    contentType: 'application/gzip',
    addRandomSuffix: false,
    ...(cacheControlMaxAge != null ? { cacheControlMaxAge } : {}),
  });
  return { url: blob.url, pathname, storedBytes: body.length, encoding: 'gzip' };
}

// Read a stored payload back by its URL, server-side, in every mode. Handles
// gzip bytes (Vercel Blob / memory), content-encoding-inflated text (R2 via
// undici) and legacy plain JSON alike. Returns null on any miss/failure.
export async function readBlobText(url: string): Promise<string | null> {
  if (useMemory) {
    const bytes = memoryStore.get(memoryPathname(url));
    return bytes === undefined ? null : inflatePayload(bytes);
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return inflatePayload(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

export async function readBlobJson<T = any>(url: string): Promise<T | null> {
  const text = await readBlobText(url);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// Delete payload blobs by URL. Routes each URL to the store that holds it (a
// row may still point at Vercel Blob while new writes go to R2), so retention
// and migration work mid-transition. Deletes are free on both stores. Throws
// if a store rejects the batch — callers must not mark rows pruned on failure.
export async function deletePayloadBlobs(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  if (useMemory) {
    for (const u of urls) {
      const p = memoryPathname(u);
      memoryStore.delete(p);
      memoryPutOptions.delete(p);
    }
    return;
  }
  const s3Keys: string[] = [];
  const vercelUrls: string[] = [];
  for (const u of urls) {
    const key = s3KeyForUrl(u);
    if (key) s3Keys.push(key);
    else vercelUrls.push(u);
  }
  if (s3Keys.length) {
    const { DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
    const client = await s3();
    for (let i = 0; i < s3Keys.length; i += 1000) {
      const chunk = s3Keys.slice(i, i + 1000);
      const res = await client.send(new DeleteObjectsCommand({
        Bucket: s3Config!.bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }));
      if (res.Errors?.length) throw new Error(`s3 delete failed for ${res.Errors.length} object(s): ${res.Errors[0]?.Message}`);
    }
  }
  if (vercelUrls.length) {
    for (let i = 0; i < vercelUrls.length; i += 100) {
      await vercelDel(vercelUrls.slice(i, i + 100));
    }
  }
}
