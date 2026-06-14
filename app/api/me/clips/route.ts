import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { corsHeaders, preflight } from '@/lib/cors';
import { authContextFromRequest } from '@/lib/replayPermissions';
import { myCreatedClips, clipsOnMyReplays } from '@/lib/clipBrowser';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// GET /api/me/clips?scope=created|on-my-replays — B142: the caller's clips.
//   created        → clips I made (session account OR X-Install-Token).
//   on-my-replays  → clips OTHERS made of replays I recorded (session only).
// Powers the anonymous client (install-token) library + is the test surface;
// the signed-in RSC calls the lib helpers directly.
export async function GET(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const scope = new URL(req.url).searchParams.get('scope') === 'on-my-replays' ? 'on-my-replays' : 'created';
    const session = await auth();
    const sessionUserId: string | null = (session?.user as any)?.id || null;
    const ctx = authContextFromRequest(req, sessionUserId);
    const data = scope === 'on-my-replays' ? await clipsOnMyReplays(ctx) : await myCreatedClips(ctx);
    return NextResponse.json({ ok: true, data }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] GET /api/me/clips failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
