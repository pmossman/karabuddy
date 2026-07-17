import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { canSeeMigrateDemo } from '@/lib/migrateDemoAccess';
import { resolveUserDecks } from '@/lib/deckVersions';
import { MigrateReview } from './MigrateReview';

// karabuddy → SWU Forge migration: review the decks + versions karabuddy pulls
// together from YOUR replays, then select / edit before migrating. Real data.
// Internal-only for now (same allowlist as the demo) while it's built out.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Migrate decks to SWU Forge',
  robots: { index: false, follow: false },
};

export default async function MigratePage() {
  const session = await auth();
  if (!canSeeMigrateDemo(session)) notFound();
  const userId = session!.user!.id;
  const decks = await resolveUserDecks(userId, { minGames: 5 });
  return <MigrateReview decks={decks} />;
}
