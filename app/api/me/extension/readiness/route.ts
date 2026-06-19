import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { extensionReadiness } from '@/lib/schema';
import { corsHeaders, preflight } from '@/lib/cors';
import { resolveUserIdFromRequest } from '@/lib/userResolution';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// POST /api/me/extension/readiness — B170 / ADR 0010.
// The extension reports its NON-SECRET capabilities + the team_key_ids it has a
// key loaded for, so a team owner's private-mode roster can show per-member
// ready / needs-update / needs-key. NEVER the key — just the public ids + the
// capability strings. Auth: session cookie OR install-token header.
export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const userId = await resolveUserIdFromRequest(req);
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401, headers });
    }
    const body = await req.json().catch(() => ({}));
    const strArr = (v: unknown): string[] =>
      Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))).slice(0, 100) : [];
    const capabilities = strArr(body.capabilities);
    const loadedKeyIds = strArr(body.loadedTeamKeyIds);

    const db = getDb();
    const values = { userId, capabilities, loadedKeyIds, updatedAt: new Date() };
    await db
      .insert(extensionReadiness)
      .values(values)
      .onConflictDoUpdate({ target: extensionReadiness.userId, set: { capabilities, loadedKeyIds, updatedAt: new Date() } });

    return NextResponse.json({ ok: true }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] POST /api/me/extension/readiness failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
