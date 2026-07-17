import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { canSeeMigrateDemo } from '@/lib/migrateDemoAccess';
import { resolveUserDecks } from '@/lib/deckVersions';
import MigrationDemo from './MigrationDemo';

// karabuddy → SWU Forge team-migration WIZARD. The step-by-step flow (team folder,
// account matching, consent) is still a prototype, but the Decks step is REAL:
// resolveUserDecks reconstructs the signed-in user's decks + version history from
// their own replays. The live SWU Forge push waits on a Forge-side handoff (see
// docs/swuforge-migration); until then the flow simulates the create.
//
// Gated to KARABUDDY_MIGRATE_DEMO_EMAILS (Parker + Andy in prod); everyone else
// 404s (no hint the route exists).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Migrate to SWU Forge',
  description: 'Team-migration wizard — real decks + version history reconstructed from your replays.',
  robots: { index: false, follow: false },
};

export default async function MigrateDemoPage() {
  const session = await auth();
  if (!canSeeMigrateDemo(session)) notFound();
  const userId = session!.user!.id;
  const realDecks = await resolveUserDecks(userId, { minGames: 5 });
  return <MigrationDemo realDecks={realDecks} />;
}
