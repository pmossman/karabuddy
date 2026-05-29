import { notFound } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, tags } from '@/lib/schema';
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

  // Serialize timestamps for client transport.
  const replay = {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
  const tagList = tagRows.map((t: any) => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
  }));

  return <ReplayViewer replay={replay} initialTags={tagList} />;
}
