import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teamMembers, teams } from '@/lib/schema';
import { StatsClient } from './StatsClient';

// B101/Phase2 (ADR 0007): the Stats/Meta surface. Server shell resolves the
// viewer's identity + teams (for the audience switcher); the client fetches
// /api/stats. Global is public (no auth) — the SEO/growth surface.
export const dynamic = 'force-dynamic';

export default async function StatsPage() {
  const session = await auth();
  const userId = ((session?.user as any)?.id as string | undefined) || null;
  let myTeams: { slug: string; name: string }[] = [];
  if (userId) {
    myTeams = await getDb()
      .select({ slug: teams.slug, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
      .where(eq(teamMembers.userId, userId));
  }
  return <StatsClient signedIn={!!userId} teams={myTeams} />;
}
