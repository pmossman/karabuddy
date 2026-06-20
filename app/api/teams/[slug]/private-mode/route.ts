import { NextResponse } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { teams, teamMembers } from '@/lib/schema';
import { resolveUserIdFromRequest } from '@/lib/userResolution';

export const runtime = 'nodejs';

// B170 / ADR 0010 — ENABLE private mode for a team. Owner-only, authed by an
// Auth.js session OR the extension install token (resolveUserIdFromRequest), so
// the extension's key manager can generate a team's key AND turn private mode on
// in one step — no trip back to karabuddy. The server stores only the non-secret
// team_key_id (the key never leaves the extension). Keys are ONE-PER-TEAM: a key
// already used by another team is rejected. (Disabling stays the session-only
// team PATCH — that's a webapp-Settings action.)
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const userId = await resolveUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const teamKeyId = String(body.teamKeyId || '').trim();
  if (!teamKeyId) {
    return NextResponse.json({ ok: false, error: 'teamKeyId required' }, { status: 400 });
  }
  const db = getDb();
  const [me] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId)))
    .limit(1);
  if (!me || me.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 });
  }
  // One-per-team: refuse a key another team already uses.
  const [clash] = await db
    .select({ slug: teams.slug })
    .from(teams)
    .where(and(eq(teams.teamKeyId, teamKeyId), ne(teams.slug, slug)))
    .limit(1);
  if (clash) {
    return NextResponse.json({ ok: false, error: 'That key is already used by another team. Generate a separate key for this team.' }, { status: 409 });
  }
  await db.update(teams).set({ privateMode: true, teamKeyId }).where(eq(teams.slug, slug));
  return NextResponse.json({ ok: true, teamKeyId });
}
