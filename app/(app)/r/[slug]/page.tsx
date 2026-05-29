import { notFound } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, tags } from '@/lib/schema';
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
  const tagRows = await db
    .select()
    .from(tags)
    .where(eq(tags.replaySlug, slug))
    .orderBy(asc(tags.frameIndex));

  // Serialize timestamps for client transport. Owner-first player order
  // (B59-followup) so the sidebar matchup + default title both read
  // "<me> vs <them>" instead of being order-dependent on the raw jsonb
  // key sort.
  const replay = {
    ...row,
    createdAt: row.createdAt.toISOString(),
    players: orderPlayersOwnerFirst(row.players, row.ownerPlayerId),
  };
  const tagList = tagRows.map((t: any) => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
  }));

  return <ReplayViewer replay={replay} initialTags={tagList} />;
}
