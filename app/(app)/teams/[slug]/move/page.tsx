import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teamMembers, teams } from '@/lib/schema';
import { forgeMigrationEnabled } from '@/lib/forgeMigration';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { MoveTeamPreview } from './MoveTeamPreview';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

// The preview screen for the KaraBuddy → SWU Forge move. Owner-only.
//
// This page shows nothing of its own: it renders a client component that calls
// Forge with `dryRun: true` and draws the plan that comes back. "Already
// offered", "declined" and "new since" are Forge's answers — it owns the
// idempotency ledger and is the only side that knows them.
//
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

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '32px 28px 80px',
        color: tokens.color.text,
        fontFamily: tokens.font.family,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: tokens.led.on,
          margin: '0 0 3px',
        }}
      >
        Team Settings
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: 26, fontWeight: 600 }}>Move to SWU Forge</h1>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: tokens.color.textSecondary }}>
        <Link href={`/teams/${slug}?tab=settings`} style={{ color: tokens.color.accentBright, textDecoration: 'none' }}>
          ← {team.name} settings
        </Link>
      </p>

      <MoveTeamPreview slug={slug} initialTeamName={team.name} />
    </main>
  );
}
