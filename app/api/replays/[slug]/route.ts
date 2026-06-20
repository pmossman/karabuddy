import { NextResponse } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, tags } from '@/lib/schema';
import { corsHeaders, preflight } from '@/lib/cors';
import { auth } from '@/auth';
import { authContextFromRequest, canMutateReplay } from '@/lib/replayPermissions';
import { canViewReplayIdentities } from '@/lib/altPerspective';
import { orderPlayersOwnerFirst } from '@/lib/players';
import { isSampleReplaySlug } from '@/lib/sampleReplays';
import { anonymizePlayersSummary, anonymizeDecks, anonByIdFromPlayers } from '@/lib/anonymizeReplay';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// Ownership: signed-in user matching replays.userId, OR caller holding the
// original installToken (X-Install-Token header). Predicate lives in
// lib/replayPermissions; this wrapper just resolves the session for the
// caller convenience.
async function canMutate(row: { userId: string | null; ownerToken: string }, req: Request) {
  const session = await auth();
  const sessionUserId: string | null = session?.user?.id || null;
  return canMutateReplay(row, authContextFromRequest(req, sessionUserId));
}

// GET /api/replays/:slug — metadata + tags + payload URL.
// Returns the Blob URL so the client can fetch the full payload directly
// from Vercel Blob (saves a hop through our function for a possibly-MB
// JSON body).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const db = getDb();
    const [row] = await db.select().from(replays).where(eq(replays.slug, slug)).limit(1);
    if (!row) {
      return NextResponse.json({ ok: false, error: 'not found' }, { status: 404, headers });
    }
    const tagRows = await db
      .select()
      .from(tags)
      .where(eq(tags.replaySlug, slug))
      .orderBy(asc(tags.frameIndex));

    // B122: this route is unauthenticated. Real karabast handles + full deck
    // lists go ONLY to the uploader or a teammate; everyone else (and curated
    // samples) gets anonymized players, NO full decklists, the anon title, and
    // no tags (tag authors are real handles). Samples keep an anonymized demo
    // decklist; real-but-unauthorized callers get no decks at all.
    const isSample = isSampleReplaySlug(slug);
    const session = await auth();
    const sessionUserId: string | null = session?.user?.id || null;
    const canView = isSample
      ? false
      : await canViewReplayIdentities(row, authContextFromRequest(req, sessionUserId));

    if (isSample || !canView) {
      const ordered = orderPlayersOwnerFirst((row as any).players, (row as any).ownerPlayerId);
      const byId = anonByIdFromPlayers(ordered as any[]);
      const data = {
        ...row,
        players: anonymizePlayersSummary(ordered as any[]),
        decks: isSample ? anonymizeDecks((row as any).decks, byId) : null,
        // A user-set title always shows (user-chosen, not a leaked handle).
        displayName: (row as any).displayName ?? null,
        tags: [],
        ownerPlayerId: null,
        userId: null,
        ownerToken: '',
      };
      return NextResponse.json({ ok: true, data }, { headers });
    }

    return NextResponse.json({ ok: true, data: { ...row, tags: tagRows } }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] GET /api/replays/:slug failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}

// PATCH /api/replays/:slug
//   body: {
//     displayName?: string | null   // B53: rename. Pass null/'' to clear.
//     labels?: string[]             // B53: free-form labels; trimmed +
//                                     deduped + capped server-side.
//     public?: boolean              // B133: owner publishes/unpublishes —
//                                     sets/clears publicAt (public browser
//                                     listing + redacted comment reads).
//   }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const db = getDb();
    const [row] = await db.select().from(replays).where(eq(replays.slug, slug)).limit(1);
    if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404, headers });
    if (!(await canMutate(row, req))) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403, headers });
    }
    const body = await req.json().catch(() => ({}));
    // B170 / ADR 0010: private (encrypted) replays can't be made public (that
    // would expose ciphertext + the metadata floor on a stranger-facing surface),
    // and their displayName/labels live in the ENCRYPTED summary — a plaintext
    // edit here would leak them. Reject those mutations for encrypted replays.
    if ((row as any).encrypted && (body.public || body.displayName !== undefined || body.labels !== undefined)) {
      return NextResponse.json({ ok: false, error: 'not available for private replays' }, { status: 400, headers });
    }
    const update: Record<string, unknown> = {};
    if (body.displayName !== undefined) {
      // B53: explicit null/empty string clears the override and the
      // viewer falls back to the auto-matchup text.
      const raw = body.displayName == null ? '' : String(body.displayName);
      const trimmed = raw.trim().slice(0, 120);
      update.displayName = trimmed.length > 0 ? trimmed : null;
    }
    if (body.labels !== undefined) {
      // B53: text[] — trim, dedupe case-insensitively (preserves first
      // casing seen), drop empties, cap to 20 labels × 40 chars each.
      const incoming = Array.isArray(body.labels) ? body.labels : [];
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const raw of incoming) {
        const s = String(raw || '').trim().slice(0, 40);
        if (!s) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push(s);
        if (cleaned.length >= 20) break;
      }
      update.labels = cleaned.length > 0 ? cleaned : null;
    }
    if (body.public !== undefined) {
      // B133: idempotent — re-publishing keeps the original publicAt (the
      // public browser sorts by it).
      update.publicAt = body.public ? (row.publicAt ?? new Date()) : null;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400, headers });
    }
    await db.update(replays).set(update).where(eq(replays.slug, slug));
    return NextResponse.json({ ok: true }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] PATCH /api/replays/:slug failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}

// DELETE /api/replays/:slug — owner-locked. Cascades to tags via FK.
// (Blob cleanup is best-effort and async; orphans are harmless.)
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const db = getDb();
    const [row] = await db.select().from(replays).where(eq(replays.slug, slug)).limit(1);
    if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404, headers });
    if (!(await canMutate(row, req))) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403, headers });
    }
    await db.delete(replays).where(eq(replays.slug, slug));
    return NextResponse.json({ ok: true }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] DELETE /api/replays/:slug failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
