import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teams, teamMembers } from '@/lib/schema';
import { generateTeamSlug } from '@/lib/slug';
import { and, eq } from 'drizzle-orm';

export const runtime = 'nodejs';

// POST /api/teams  body: { name }
// Creates a new team. Caller becomes its first owner. Returns { slug }.
export async function POST(req: Request) {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const name: string = String(body.name || '').trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ ok: false, error: 'name too long (80 char max)' }, { status: 400 });
  }

  const db = getDb();

  // Slug collision retry — generateTeamSlug is 32^6 ≈ 1B possibilities;
  // 2 retries is overkill but cheap.
  let slug: string | null = null;
  for (let i = 0; i < 3; i++) {
    const candidate = generateTeamSlug();
    try {
      await db.insert(teams).values({ slug: candidate, name, createdBy: userId });
      slug = candidate;
      break;
    } catch (err: any) {
      // Postgres unique violation = 23505. Retry; any other error rethrows.
      if (err?.code !== '23505') throw err;
    }
  }
  if (!slug) {
    return NextResponse.json({ ok: false, error: 'slug collision (try again)' }, { status: 500 });
  }

  await db.insert(teamMembers).values({ teamSlug: slug, userId, role: 'owner' });

  return NextResponse.json({ ok: true, slug });
}

// GET /api/teams — list teams the signed-in user belongs to.
export async function GET() {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const db = getDb();
  const rows = await db
    .select({
      slug: teams.slug,
      name: teams.name,
      createdAt: teams.createdAt,
      role: teamMembers.role,
      joinedAt: teamMembers.joinedAt,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
    .where(eq(teamMembers.userId, userId))
    .orderBy(teamMembers.joinedAt);
  return NextResponse.json({ ok: true, data: rows });
}
