import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, tags } from '@/lib/schema';
import { decodeReplay } from '@/lib/replayDecoder';
import { buildMomentCard, type MomentCardModel, type SideModel } from '@/lib/momentCard';
import { orderPlayersOwnerFirst } from '@/lib/players';
import { isSampleReplaySlug } from '@/lib/sampleReplays';
import { anonByIdFromPlayers, anonymizePlayersSummary } from '@/lib/anonymizeReplay';
import { verifyMoment } from '@/lib/shareToken';
import { MomentCard } from './MomentCard';

export const runtime = 'nodejs';

const SIZE = { width: 1200, height: 630 };
// In prod the (slug,f,t) image is stable → cache hard on the CDN. In dev, never
// cache so design changes show on refresh (Next caches route responses with a
// max-age header otherwise).
const CACHE = {
  'Cache-Control': process.env.NODE_ENV === 'development'
    ? 'no-store, max-age=0'
    : 'public, max-age=300, s-maxage=86400',
};

// Satori can't embed webp, so convert each card's art to a png data-URL once
// (memoized by URL across warm invocations). A failure → null → the renderer
// falls back to a text tile for that card.
const artCache = new Map<string, Promise<string | null>>();
function cardArtToDataUrl(url: string): Promise<string | null> {
  let p = artCache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        const png = await sharp(buf).resize(220).png().toBuffer();
        return 'data:image/png;base64,' + png.toString('base64');
      } catch {
        return null;
      }
    })();
    artCache.set(url, p);
  }
  return p;
}

const emptySide = (name: string): SideModel => ({ name, leader: null, base: null, ground: [], space: [], extraGround: 0, extraSpace: 0, availableResources: 0, handCount: 0 });
const defaultModel = (frameLabel: string): MomentCardModel => ({ matchup: { top: emptySide('Player 2'), bottom: emptySide('Player 1') }, roundLabel: '', frameLabel, tagLine: null });

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

async function buildModel(slug: string, fParam: string | null, tParam: string | null): Promise<MomentCardModel> {
  const db = getDb();
  const [row] = await db.select().from(replays).where(eq(replays.slug, slug)).limit(1);
  if (!row) return defaultModel('Replay not found');

  const payload = await (await fetch(row.payloadBlobUrl)).json();
  const decoded = decodeReplay(payload);
  const frameIndex = Math.max(0, (parseInt(fParam || '1', 10) || 1) - 1);

  // B122: the moment card is a PUBLIC link unfurl — a crawler/unfurl bot has no
  // viewer identity, so it must NEVER carry karabast handles. Always anonymize
  // the player labels (the card leads with leaders/bases anyway). The B113
  // signed tag token is independent — the sharer authorized that one tag.
  const ownerPlayerId = (row.ownerPlayerId as string | null) ?? decoded.meta?.localPlayerId ?? null;
  const ordered = orderPlayersOwnerFirst(row.players as any[], ownerPlayerId);
  const players = anonymizePlayersSummary(ordered as any[]);
  const anonById = anonByIdFromPlayers(ordered as any[]);

  // tag is opt-in (signed token); samples never have real tags.
  let tagComment: string | null = null;
  if (tParam && !isSampleReplaySlug(slug)) {
    const claim = verifyMoment(tParam);
    if (claim && claim.slug === slug && claim.frameIndex === frameIndex) {
      const [tag] = await db.select().from(tags).where(eq(tags.id, claim.tagId)).limit(1);
      if (tag && tag.replaySlug === slug && tag.frameIndex === frameIndex && tag.comment) tagComment = tag.comment;
    }
  }

  return buildMomentCard({ decoded, ownerPlayerId, frameIndexOriginal: frameIndex, players: players as any, anonById, tagComment });
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let model: MomentCardModel;
  try {
    const { slug } = await params;
    const url = new URL(req.url);
    model = await buildModel(slug, url.searchParams.get('f'), url.searchParams.get('t'));
  } catch (err: any) {
    console.error('[karabuddy] og-image build failed:', err);
    model = defaultModel('KaraBuddy replay');
  }
  const art = await buildArtMap(model);
  return new ImageResponse(MomentCard({ model, art }) as any, { ...SIZE, headers: CACHE });
}
