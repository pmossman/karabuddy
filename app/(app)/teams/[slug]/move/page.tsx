import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teamMembers, teams } from '@/lib/schema';
import { forgeMigrationEnabled } from '@/lib/forgeMigration';
import { hubMovePath } from '@/app/_components/forgeAnnouncement/constants';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

// 404 (not 403) for non-owners, while the feature is dark, and for anyone
// outside the limited-trial allowlist — so a route that isn't live yet, or
// isn't live for you, is indistinguishable from one that doesn't exist.
export default async function MoveTeamPage({ params }: PageProps) {
  const { slug } = await params;

  const session = await auth();
  const userId = session?.user?.id || null;
  if (!userId) {
    redirect(`/signin?callbackUrl=/teams/${slug}/move`);
  }

  if (!forgeMigrationEnabled()) notFound();

  const db = getDb();
  const [team] = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
  if (!team) notFound();

  const [me] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId)))
    .limit(1);
  if (!me || me.role !== 'owner') notFound();

  redirect(hubMovePath(slug));
}
