import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, tags } from '@/lib/schema';
import { generateSlug, generateTagId } from '@/lib/slug';
import { corsHeaders, preflight } from '@/lib/cors';
import { resolveUserId } from '@/lib/userResolution';

export const runtime = 'nodejs';
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

export function OPTIONS(req: Request) {
  return preflight(req);
}

// POST /api/replays — upload a replay payload + create metadata row.
// Body shape: { installToken, payload: string (JSON of the .karareplay file) }
// Returns: { slug, url }
export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const body = await req.json();
    const installToken: string = String(body.installToken || '').trim();
    const payloadText: string = typeof body.payload === 'string' ? body.payload : '';
    if (!installToken) {
      return NextResponse.json({ ok: false, error: 'installToken required' }, { status: 400, headers });
    }
    if (!payloadText) {
      return NextResponse.json({ ok: false, error: 'payload required' }, { status: 400, headers });
    }
    if (payloadText.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: 'payload too large' }, { status: 413, headers });
    }

    // Validate the payload looks like one of our replays — version + events
    // + an initial gamestate snapshot we can read player metadata from.
    let parsed: any;
    try { parsed = JSON.parse(payloadText); } catch {
      return NextResponse.json({ ok: false, error: 'payload is not valid JSON' }, { status: 400, headers });
    }
    if (parsed?.version !== 1 && parsed?.version !== 2) {
      return NextResponse.json({ ok: false, error: 'unsupported replay version' }, { status: 400, headers });
    }
    const firstGamestate = (parsed.events || []).find(
      (e: any) => e.event === 'gamestate' && e.args?.[0]
    );
    const snapshot = firstGamestate?.args?.[0]?.full
      || (parsed.version === 1 ? firstGamestate?.args?.[0] : null);
    const gameId: string | null = snapshot?.id || null;
    if (!gameId) {
      return NextResponse.json({ ok: false, error: 'no gameId in payload' }, { status: 400, headers });
    }
    const players = snapshot?.players
      ? Object.values(snapshot.players).map((p: any) => ({
          username: p.user?.username || '',
          leader: p.leader ? { name: p.leader.name || '', set: p.leader.setId?.set || '', number: p.leader.setId?.number || 0 } : null,
          base: p.base ? { name: p.base.name || '', set: p.base.setId?.set || '', number: p.base.setId?.number || 0 } : null,
        }))
      : [];

    const db = getDb();

    // Dedupe by gameId — if this match was already uploaded, return the
    // existing slug instead of creating a duplicate.
    const existing = await db.select().from(replays).where(eq(replays.gameId, gameId)).limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ ok: true, slug: existing[0].slug, url: `/r/${existing[0].slug}`, deduped: true }, { headers });
    }

    const recordedUsername = players.find((p: any) => p?.username)?.username || null;
    const userId = await resolveUserId({ installToken, recordedUsername });

    // New row → write payload to Blob, then insert metadata.
    const slug = generateSlug();
    const blob = await put(`replays/${slug}.json`, payloadText, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });

    await db.insert(replays).values({
      slug,
      gameId,
      userId,
      ownerToken: installToken,
      players,
      durationMs: parsed.durationMs || 0,
      actionCount: parsed.actionCount || 0,
      payloadBlobUrl: blob.url,
      payloadSizeBytes: payloadText.length,
      visibility: 'unlisted',
    });

    // Lift tags embedded in the payload into the tags table so the viewer
    // page reads them via the same relational source as web-added tags.
    // Same user-attribution logic as the replay row: signed-in or matched
    // by karabastUsername → userId; otherwise anon by installToken.
    const payloadTags = Array.isArray(parsed.tags) ? parsed.tags : [];
    if (payloadTags.length > 0) {
      await db.insert(tags).values(
        payloadTags
          .filter((t: any) => Number.isFinite(t?.frameIndex))
          .map((t: any) => ({
            id: t.id || generateTagId(),
            replaySlug: slug,
            frameIndex: Math.max(0, Math.floor(t.frameIndex)),
            userId,
            authorToken: installToken,
            authorName: String(t.author || 'anon'),
            comment: String(t.comment || ''),
          }))
      );
    }

    return NextResponse.json({ ok: true, slug, url: `/r/${slug}` }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] POST /api/replays failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}

// GET /api/replays?owner=<installToken> — list replays. With no owner param,
// returns recent public replays (TBD when we have public ones); with owner,
// returns that token's library.
export async function GET(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const url = new URL(req.url);
    const owner = url.searchParams.get('owner');
    const db = getDb();
    const rows = owner
      ? await db.select().from(replays).where(eq(replays.ownerToken, owner)).limit(100)
      : await db.select().from(replays).where(eq(replays.visibility, 'public')).limit(50);
    return NextResponse.json({ ok: true, data: rows }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] GET /api/replays failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
