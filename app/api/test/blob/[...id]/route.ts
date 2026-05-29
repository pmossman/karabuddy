import { NextResponse } from 'next/server';
import { getMemoryBlob } from '@/lib/blob';

export const runtime = 'nodejs';

// Test-only blob fetch. Mirrors what Vercel Blob's served URL would do:
// return the stored bytes. Disabled outside KARABUDDY_BLOB_MODE=memory.
//
// The URL shape is exactly what `lib/blob.ts`'s memoryPut returns
// (`/api/test/blob/<pathname>`), so the viewer + replay-decoder flow
// works unchanged against the test server.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string[] }> }) {
  if (process.env.KARABUDDY_BLOB_MODE !== 'memory') {
    return NextResponse.json({ ok: false, error: 'test blob mode not enabled' }, { status: 404 });
  }
  const { id } = await params;
  const pathname = id.join('/');
  const body = getMemoryBlob(pathname);
  if (body === undefined) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }
  return new NextResponse(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
