import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { clips, replays } from '@/lib/schema';
import { orderPlayersOwnerFirst } from '@/lib/players';
import { isSampleReplaySlug } from '@/lib/sampleReplays';
import { canViewReplayIdentities } from '@/lib/altPerspective';
import { auth } from '@/auth';
import { ClipPlayer } from './ClipPlayer';

export const dynamic = 'force-dynamic';

interface PageProps { params: Promise<{ slug: string }> }

// One query shared by generateMetadata + the page.
const loadClip = cache(async (slug: string) => {
  const db = getDb();
  const [clip] = await db.select().from(clips).where(eq(clips.slug, slug)).limit(1);
  if (!clip) return null;
  const [replay] = await db.select().from(replays).where(eq(replays.slug, clip.replaySlug)).limit(1);
  if (!replay) return null;
  return { clip, replay };
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadClip(slug);
  if (!loaded) return { title: 'Clip · KaraBuddy' };
  const { clip, replay } = loaded;

  const session = await auth();
  const viewerUserId = session?.user?.id ?? null;
  const anonymize = isSampleReplaySlug(replay.slug)
    || !(await canViewReplayIdentities(replay, { sessionUserId: viewerUserId, installToken: null }));
  const ordered = orderPlayersOwnerFirst(replay.players, replay.ownerPlayerId) as any[];
  const nameOf = (p: any) => p?.username ?? 'Player';
  const matchup = `${ordered[0]?.leader?.name ?? 'Unknown'} vs ${ordered[1]?.leader?.name ?? 'Unknown'}`;
  const subjects = anonymize ? matchup : `${nameOf(ordered[0])} vs ${nameOf(ordered[1])}`;
  const titleText = clip.title || `Clip — ${matchup}`;
  const description = `${subjects} · a Star Wars Unlimited clip on KaraBuddy.`;
  const image = `/api/clips/${slug}/og-image`;

  return {
    title: `${titleText} · KaraBuddy`,
    description,
    openGraph: { title: titleText, description, type: 'video.other', images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title: titleText, description, images: [image] },
  };
}

export default async function ClipPage({ params }: PageProps) {
  const { slug } = await params;
  const loaded = await loadClip(slug);
  if (!loaded) notFound();
  const { clip, replay } = loaded;

  const session = await auth();
  const viewerUserId = session?.user?.id ?? null;
  const ctx = { sessionUserId: viewerUserId, installToken: null };
  const anonymize = isSampleReplaySlug(replay.slug) || !(await canViewReplayIdentities(replay, ctx));

  // Show the delete affordance to a signed-in creator OR the replay owner. An
  // anonymous (install-token) creator deletes from the builder right after
  // creating; the DELETE route is the real boundary either way.
  const canDelete = !!viewerUserId && (clip.userId === viewerUserId || replay.userId === viewerUserId);

  return (
    <ClipPlayer
      clipSlug={clip.slug}
      replaySlug={clip.replaySlug}
      payloadBlobUrl={(replay as any).payloadBlobUrl}
      startFrame={clip.startFrame}
      endFrame={clip.endFrame}
      title={clip.title}
      // POV is derived client-side from the decoded payload (the recorder's
      // captured perspective), identical to the replay viewer — see playback.ts.
      anonymize={anonymize}
      canDelete={canDelete}
    />
  );
}
