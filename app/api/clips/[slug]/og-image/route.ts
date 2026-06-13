import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { clips, replays } from '@/lib/schema';
import { decodeReplay } from '@/lib/replayDecoder';
import { buildMomentCard, type MomentCardModel } from '@/lib/momentCard';
import { orderPlayersOwnerFirst } from '@/lib/players';
import { anonByIdFromPlayers, anonymizePlayersSummary } from '@/lib/anonymizeReplay';
import { MomentCard } from '@/app/api/replays/[slug]/og-image/MomentCard';

export const runtime = 'nodejs';

const SIZE = { width: 1200, height: 630 };
const CACHE = {
  'Cache-Control': process.env.NODE_ENV === 'development' ? 'no-store, max-age=0' : 'public, max-age=300, s-maxage=86400',
};

// Satori can't embed webp — convert each card's art to a PNG data-URL once.
const artCache = new Map<string, Promise<string | null>>();
function cardArtToDataUrl(url: string): Promise<string | null> {
  let p = artCache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        const png = await sharp(buf).png().toBuffer();
        return `data:image/png;base64,${png.toString('base64')}`;
      } catch { return null; }
    })();
    artCache.set(url, p);
  }
  return p;
}

async function buildArtMap(model: MomentCardModel): Promise<Map<string, string>> {
  const urls = new Set<string>();
  for (const side of [model.matchup.top, model.matchup.bottom]) {
    if (side.leader) urls.add(side.leader.artUrl);
    if (side.base) urls.add(side.base.artUrl);
    for (const u of [...side.ground, ...side.space]) urls.add(u.artUrl);
  }
  const entries = await Promise.all([...urls].map(async (u) => [u, await cardArtToDataUrl(u)] as const));
  const map = new Map<string, string>();
  for (const [u, d] of entries) if (d) map.set(u, d);
  return map;
}

const emptyModel: MomentCardModel = {
  matchup: {
    top: { name: 'Player 2', leader: null, base: null, ground: [], space: [], extraGround: 0, extraSpace: 0, availableResources: 0, handCount: 0 },
    bottom: { name: 'Player 1', leader: null, base: null, ground: [], space: [], extraGround: 0, extraSpace: 0, availableResources: 0, handCount: 0 },
  },
  roundLabel: '', frameLabel: 'Clip', tagLine: null,
};

// GET /api/clips/[slug]/og-image — B136: a static moment-card thumbnail of the
// clip's START frame (always anonymized — a crawler has no identity), captioned
// with a ▶ CLIP badge + the title. Reuses lib/momentCard + the MomentCard JSX.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let model = emptyModel;
  try {
    const { slug } = await params;
    const db = getDb();
    const [clip] = await db.select().from(clips).where(eq(clips.slug, slug)).limit(1);
    if (clip) {
      const [replay] = await db.select().from(replays).where(eq(replays.slug, clip.replaySlug)).limit(1);
      if (replay) {
        const payload = await (await fetch((replay as any).payloadBlobUrl)).json();
        const decoded = decodeReplay(payload);
        const ownerPlayerId = ((replay as any).ownerPlayerId as string | null) ?? decoded.meta?.localPlayerId ?? null;
        const ordered = orderPlayersOwnerFirst((replay as any).players, ownerPlayerId);
        model = buildMomentCard({
          decoded,
          ownerPlayerId,
          frameIndexOriginal: clip.startFrame,
          players: anonymizePlayersSummary(ordered as any[]) as any,
          anonById: anonByIdFromPlayers(ordered as any[]),
          tagComment: clip.title ? `🎬 ${clip.title}` : null,
        });
        model = { ...model, frameLabel: '▶ CLIP' };
      }
    }
  } catch (err: any) {
    console.error('[karabuddy] clip og-image build failed:', err);
  }
  const art = await buildArtMap(model);
  return new ImageResponse(MomentCard({ model, art }) as any, { ...SIZE, headers: CACHE });
}
