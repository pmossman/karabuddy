import { NextResponse } from 'next/server';
import { corsHeaders, preflight } from '@/lib/cors';
import { resolveUserId } from '@/lib/userResolution';
import { canViewAltPerspective, loadAltPayloadForServing } from '@/lib/altPerspective';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// GET /api/replays/:slug/perspective
//
// B112: serves the SECOND player's recording (the alt perspective) for a
// double-sided replay. This reveals a player's otherwise-hidden hand, so it is
// gated: the caller must be a signed-in member of a team the replay is shared
// with, AND both recorders must be members of that team (see
// canViewAltPerspective — the single source of truth, also used by the viewer
// page to decide whether to show the Flip control). The payload bytes live in a
// private Postgres side table and are returned only after the gate passes —
// never exposed as a URL.
//
// 401/403 = not entitled; 404 = no alt stored (or a sample replay).
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

    const allowed = await canViewAltPerspective(slug, viewerUserId);
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'not available' }, { status: 403, headers });
    }

    const alt = await loadAltPayloadForServing(slug);
    if (!alt) {
      return NextResponse.json({ ok: false, error: 'no alternate perspective' }, { status: 404, headers });
    }

    return NextResponse.json(
      { ok: true, payload: alt.payload, altOwnerPlayerId: alt.altOwnerPlayerId },
      { headers },
    );
  } catch (err: any) {
    console.error('[karabuddy] GET /api/replays/:slug/perspective failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
