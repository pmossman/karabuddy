import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teamMemberPrefs } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';

export const runtime = 'nodejs';

// B81: the caller's per-team Discord DM preferences. Member-only. Both default
// ON; the global kill switch (users.notificationsDisabled) overrides these.
//
//   GET   → { ok, dmOnDirectMention, dmOnTeamMention }
//   PATCH { dmOnDirectMention?, dmOnTeamMention? }  (upsert; omitted = unchanged)

async function memberOf(slug: string): Promise<string | null> {
  const session = await auth();
  const id: string | null = session?.user?.id || null;
  if (!id) return null;
  const m = await getTeamMembership(slug, id);
  return m ? id : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const userId = await memberOf(slug);
  if (!userId) return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  const [row] = await getDb()
    .select()
    .from(teamMemberPrefs)
    .where(and(eq(teamMemberPrefs.teamSlug, slug), eq(teamMemberPrefs.userId, userId)))
    .limit(1);
  return NextResponse.json({
    ok: true,
    // B99: strictly opt-in — no row means OFF (not enabled).
    dmOnDirectMention: row ? row.dmOnDirectMention : false,
    dmOnTeamMention: row ? row.dmOnTeamMention : false,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const userId = await memberOf(slug);
  if (!userId) return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const db = getDb();
  const [existing] = await db
    .select()
    .from(teamMemberPrefs)
    .where(and(eq(teamMemberPrefs.teamSlug, slug), eq(teamMemberPrefs.userId, userId)))
    .limit(1);
  // B99: strictly opt-in — an omitted field on a brand-new row stays OFF
  // (false), not the old opt-out default.
  const next = {
    dmOnDirectMention: typeof body.dmOnDirectMention === 'boolean' ? body.dmOnDirectMention : existing?.dmOnDirectMention ?? false,
    dmOnTeamMention: typeof body.dmOnTeamMention === 'boolean' ? body.dmOnTeamMention : existing?.dmOnTeamMention ?? false,
  };
  await db
    .insert(teamMemberPrefs)
    .values({ teamSlug: slug, userId, ...next })
    .onConflictDoUpdate({ target: [teamMemberPrefs.teamSlug, teamMemberPrefs.userId], set: next });
  return NextResponse.json({ ok: true, ...next });
}
