import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { teams } from '@/lib/schema';
import { requireTeamMember } from '@/lib/apiAuth';

// Permanently delete a team — OWNER ONLY, irreversible. `DELETE /api/teams/[slug]`
// already means "leave the team", so a real destroy is this explicit POST.
//
// Every team-child FK is onDelete:cascade — members, invites, replay shares,
// tag-team-scope, review marks, member prefs, and the whole tournament subtree
// (entrants/rounds/matches) — so one delete cleans it all. `replays` and `tags`
// have NO team FK, so members KEEP their replays: they're just un-shared, and tags
// lose only their team scope. The owner must type the team name to confirm (also
// re-checked here, defense-in-depth against a stray client).
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug, { role: 'owner' });
  if (m instanceof NextResponse) return m;

  const db = getDb();
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.slug, slug)).limit(1);
  if (!team) return NextResponse.json({ ok: false, error: 'team not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const confirm = typeof body.confirm === 'string' ? body.confirm.trim() : '';
  if (confirm !== team.name) {
    return NextResponse.json({ ok: false, error: 'type the team name exactly to confirm' }, { status: 400 });
  }

  await db.delete(teams).where(eq(teams.slug, slug)); // cascades to every team-child table
  return NextResponse.json({ ok: true });
}
