import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users, teamMembers } from '@/lib/schema';
import { resolveUserIdFromRequest } from '@/lib/userResolution';

// Per-user extension settings, synced across devices (B75). Auth via session
// OR the X-Install-Token header (same as /api/me/whoami) so the extension SW
// can read/write without depending on cross-origin cookies.
//
//   GET   → { ok, shareTeamSlugs, minUploadActions }
//   PATCH { shareTeamSlugs?, minUploadActions? } → updates the provided fields
//
// shareTeamSlugs = the bubble's persistent "armed teams" (auto-share targets),
// always clamped to teams the user actually belongs to. minUploadActions = the
// per-player action threshold the recorder gates auto-uploads on (1–50).

const MIN_ACTIONS_FLOOR = 1;
const MIN_ACTIONS_CEIL = 50;
export const DEFAULT_MIN_UPLOAD_ACTIONS = 5;

async function loadSettings(userId: string) {
  const db = getDb();
  const [user] = await db
    .select({ slugs: users.defaultShareTeamSlugs, minActions: users.minUploadActions, excludeGlobal: users.excludeFromGlobalStats })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return {
    shareTeamSlugs: user?.slugs ?? [],
    minUploadActions: user?.minActions ?? DEFAULT_MIN_UPLOAD_ACTIONS,
    excludeFromGlobalStats: user?.excludeGlobal ?? false,
  };
}

export async function GET(req: Request) {
  const userId = await resolveUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await loadSettings(userId)) });
}

export async function PATCH(req: Request) {
  const userId = await resolveUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const db = getDb();
  const patch: { defaultShareTeamSlugs?: string[]; minUploadActions?: number; excludeFromGlobalStats?: boolean } = {};

  // B101: opt out of the global stats corpus (personal/team scopes unaffected).
  if (typeof body.excludeFromGlobalStats === 'boolean') patch.excludeFromGlobalStats = body.excludeFromGlobalStats;

  if (Array.isArray(body.shareTeamSlugs)) {
    // Clamp to the user's actual memberships — never persist a slug they
    // aren't (or are no longer) on, so a stale/forged slug can't stick.
    const memberRows = await db
      .select({ teamSlug: teamMembers.teamSlug })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));
    const mine = new Set(memberRows.map((r) => r.teamSlug));
    const requested = body.shareTeamSlugs.filter((s: unknown) => typeof s === 'string');
    patch.defaultShareTeamSlugs = [...new Set<string>(requested)].filter((s) => mine.has(s));
  }

  if (body.minUploadActions !== undefined) {
    const n = Math.round(Number(body.minUploadActions));
    if (!Number.isFinite(n)) {
      return NextResponse.json({ ok: false, error: 'minUploadActions must be a number' }, { status: 400 });
    }
    patch.minUploadActions = Math.min(MIN_ACTIONS_CEIL, Math.max(MIN_ACTIONS_FLOOR, n));
  }

  if (Object.keys(patch).length > 0) {
    await db.update(users).set(patch).where(eq(users.id, userId));
  }
  return NextResponse.json({ ok: true, ...(await loadSettings(userId)) });
}
