import { NextResponse } from 'next/server';
import { corsHeaders, preflight } from '@/lib/cors';
import { resolveUserId } from '@/lib/userResolution';
import { entitledSibling } from '@/lib/doubleSided';
import { readBlobText } from '@/lib/blob';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// GET /api/replays/:slug/perspective
//
// B166: serves the OTHER player's recording (the second POV) for a double-sided
// replay. The 2nd POV is now an independent SIBLING row (same gameId, the other
// recorder), composed at runtime — not a stored alt payload. This reveals a
// player's otherwise-hidden hand, so it is gated by `entitledSibling` (the
// single source of truth, also used by the viewer page to gate the Flip
// control): the two recorders may compose while they currently share a team; a
// third-party teammate may compose only on a team containing both recorders that
// the replay is shared with. The sibling's payload is read server-side and
// returned only after the gate passes — its blob URL is never exposed here.
//
// Response shape is unchanged ({ payload, altOwnerPlayerId }) so the viewer's
// compose/flip machinery is untouched.
//
// 401 = anonymous; 403 = no entitled sibling; 404 = sibling payload unreadable.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const installToken = (req.headers.get('x-install-token') || '').trim() || null;
    const viewerUserId = await resolveUserId({ installToken });
    if (!viewerUserId) {
      return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401, headers });
    }

    const sibling = await entitledSibling(slug, viewerUserId);
    if (!sibling) {
      return NextResponse.json({ ok: false, error: 'not available' }, { status: 403, headers });
    }

    const payload = await readBlobText(sibling.payloadBlobUrl);
    if (!payload) {
      return NextResponse.json({ ok: false, error: 'no alternate perspective' }, { status: 404, headers });
    }

    return NextResponse.json(
      { ok: true, payload, altOwnerPlayerId: sibling.ownerPlayerId },
      { headers },
    );
  } catch (err: any) {
    console.error('[karabuddy] GET /api/replays/:slug/perspective failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
