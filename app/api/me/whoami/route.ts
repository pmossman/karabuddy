import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/schema';
import { corsHeaders, preflight } from '@/lib/cors';
import { resolveUserIdFromRequest } from '@/lib/userResolution';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// GET /api/me/whoami — minimal "who am I, as karabuddy sees me" surface.
// Used by the extension bubble so it can render "Signed in as <name>"
// in the expanded panel, proving the install token is linked to an
// account. Auth path mirrors /api/me/teams-mention-data: session OR
// install-token header.
export async function GET(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'));
  const userId = await resolveUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401, headers });
  }
  const db = getDb();
  const [u] = await db
    .select({
      id: users.id,
      name: users.name,
      image: users.image,
      karabastUsername: users.karabastUsername,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) {
    return NextResponse.json({ ok: false, error: 'user not found' }, { status: 404, headers });
  }
  return NextResponse.json({
    ok: true,
    user: {
      id: u.id,
      // Prefer karabastUsername (matches what shows on karabast.net) →
      // user.name (OAuth display) → null.
      displayName: u.karabastUsername || u.name || null,
      name: u.name,
      karabastUsername: u.karabastUsername,
      image: u.image,
    },
  }, { headers });
}
