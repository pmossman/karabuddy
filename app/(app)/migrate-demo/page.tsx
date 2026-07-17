import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { canSeeMigrateDemo } from '@/lib/migrateDemoAccess';
import { resolveUserDecks } from '@/lib/deckVersions';
import { MigrateReview } from './MigrateReview';

// karabuddy → SWU Forge deck migration. Reconstructs your decks + their version
// history from your own replays (grouped by leader/base, versioned by the combined
// main+sideboard set over time), then lets you select / scrub versions / migrate.
// REAL data — resolveUserDecks reads your replays. The live SWU Forge push waits on
// a Forge-side handoff (see docs/swuforge-migration); until then the action confirms
// the prepared selection instead of faking a create.
//
// Kept on the /migrate-demo path on purpose — it's the URL Parker + Andy already
// have. Access-gated to KARABUDDY_MIGRATE_DEMO_EMAILS (Parker + Andy in prod);
// everyone else 404s (no hint the route exists).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Migrate decks to SWU Forge',
  description: 'Reconstruct your decks + version history from your replays, then migrate to SWU Forge.',
  robots: { index: false, follow: false },
};

export default async function MigrateDemoPage() {
  const session = await auth();
  if (!canSeeMigrateDemo(session)) notFound();
  const userId = session!.user!.id;
  const decks = await resolveUserDecks(userId, { minGames: 5 });
  return <MigrateReview decks={decks} />;
}
