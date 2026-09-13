import { NextResponse } from 'next/server';
import { getMemoryBlobBytes } from '@/lib/blob';

export const runtime = 'nodejs';

// Test-only blob fetch. Mirrors what Vercel Blob's served URL would do:
// return the stored bytes — gzip-compressed, with NO content-encoding, exactly
// like Vercel Blob — so the viewer's decode path (lib/payloadFetch.ts) is
// exercised for real. Disabled outside KARABUDDY_BLOB_MODE=memory.
//
// The URL shape is exactly what `lib/blob.ts`'s memory driver returns
// (`/api/test/blob/<pathname>`), so the viewer + replay-decoder flow
// works unchanged against the test server.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string[] }> }) {
  if (process.env.KARABUDDY_BLOB_MODE !== 'memory') {
    return NextResponse.json({ ok: false, error: 'test blob mode not enabled' }, { status: 404 });
  }
  const { id } = await params;
  const pathname = id.join('/');
  const body = getMemoryBlobBytes(pathname);
  if (body === undefined) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }
  return new NextResponse(Buffer.from(body), {
    status: 200,
    headers: { 'content-type': 'application/gzip', 'cache-control': 'no-store' },
  });
}
