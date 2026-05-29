import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teamMembers, teams, users } from '@/lib/schema';
import { corsHeaders, preflight } from '@/lib/cors';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// GET /api/me/teams-mention-data
// Returns the user's teams + every teammate across all of them, in a
// shape the @-mention autocomplete (web + extension) can consume:
//
//   { teams: [{slug, name}], members: [{userId, handle, displayName, teamSlugs}] }
//
// `handle` is what the user types after `@` — karabastUsername if set,
// else name, else userId-prefix. `teamSlugs` lists every team this
// member shares with the caller (so the UI can show "@bob (Team Foo,
// Team Bar)" if needed).
//
// Caller must be signed in. Returned with CORS so the extension can fetch
// it directly from the page world (currently routes through the bridge —
// CORS lets us short-circuit later if useful).
export async function GET(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'));
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401, headers });
  }

  const db = getDb();

  // The user's teams.
  const myTeams = await db
    .select({ slug: teams.slug, name: teams.name })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
    .where(eq(teamMembers.userId, userId));

  if (myTeams.length === 0) {
    return NextResponse.json({ ok: true, teams: [], members: [] }, { headers });
  }

  // Every member of those teams (including the caller — the UI can filter).
  const teamSlugs = myTeams.map((t) => t.slug);
  const memberRows = await db
    .select({
      userId: teamMembers.userId,
      teamSlug: teamMembers.teamSlug,
      name: users.name,
      karabastUsername: users.karabastUsername,
      image: users.image,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(inArray(teamMembers.teamSlug, teamSlugs));

  // Group by userId so each member appears once with all their team slugs.
  const byUser = new Map<string, {
    userId: string;
    handle: string;
    displayName: string;
    image: string | null;
    teamSlugs: string[];
  }>();
  for (const r of memberRows) {
    const handle = (r.karabastUsername || r.name || r.userId.slice(0, 6)).trim();
    const displayName = (r.name || r.karabastUsername || handle).trim();
    const existing = byUser.get(r.userId);
    if (existing) {
      existing.teamSlugs.push(r.teamSlug);
    } else {
      byUser.set(r.userId, {
        userId: r.userId,
        handle,
        displayName,
        image: r.image,
        teamSlugs: [r.teamSlug],
      });
    }
  }

  return NextResponse.json({
    ok: true,
    teams: myTeams,
    members: Array.from(byUser.values()),
  }, { headers });
}
