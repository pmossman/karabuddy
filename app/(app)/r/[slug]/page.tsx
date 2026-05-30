import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays } from '@/lib/schema';
import { orderPlayersOwnerFirst } from '@/lib/players';
import { ReplayViewer } from './ReplayViewer';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function ReplayPage({ params }: PageProps) {
  const { slug } = await params;
  const db = getDb();
  const [row] = await db.select().from(replays).where(eq(replays.slug, slug)).limit(1);
  if (!row) notFound();

  // Serialize timestamps for client transport. Owner-first player order
  // (B59-followup) so the sidebar matchup + default title both read
  // "<me> vs <them>" instead of being order-dependent on the raw jsonb
  // key sort.
  const replay = {
    ...row,
    createdAt: row.createdAt.toISOString(),
    players: orderPlayersOwnerFirst(row.players, row.ownerPlayerId),
  };

  // B71: tags are no longer SSR'd — the viewer fetches them from
  // GET /api/replays/[slug]/tags so the server can scope them to the
  // viewer (own + team-scoped only). SSR'ing all tags would leak other
  // teams' / others' personal comments into the initial HTML.
  return <ReplayViewer replay={replay} initialTags={[]} />;
}
