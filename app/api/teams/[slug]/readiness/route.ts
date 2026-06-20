import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teams, teamMembers, users, extensionReadiness } from '@/lib/schema';
import { memberReadinessStatus } from '@/lib/privateTeams';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/readiness — B170 / ADR 0010. Owner-facing private-team
// roster: each member's readiness (ready / needs-update / needs-key / not-seen)
// for the team's key, derived from extension_readiness (capabilities + loaded
// key ids — never the key). Owner-only; non-private teams return an empty roster.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = session?.user?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });

  const db = getDb();
  const [team] = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
  if (!team) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  const [me] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId)))
    .limit(1);
  if (!me || me.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 });
  }

  const rows = await db
    .select({
      userId: teamMembers.userId,
      role: teamMembers.role,
      name: users.name,
      capabilities: extensionReadiness.capabilities,
      loadedKeyIds: extensionReadiness.loadedKeyIds,
      updatedAt: extensionReadiness.updatedAt,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .leftJoin(extensionReadiness, eq(extensionReadiness.userId, teamMembers.userId))
    .where(eq(teamMembers.teamSlug, slug));

  const members = rows.map((r) => ({
    userId: r.userId,
    name: r.name || r.userId.slice(0, 6),
    role: r.role,
    status: memberReadinessStatus({
      teamKeyId: team.teamKeyId,
      reported: r.updatedAt != null,
      capabilities: r.capabilities,
      loadedKeyIds: r.loadedKeyIds,
    }),
  }));

  return NextResponse.json({ ok: true, privateMode: !!team.privateMode, teamKeyId: team.teamKeyId, members });
}
