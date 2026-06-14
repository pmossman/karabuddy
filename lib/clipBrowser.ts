// B142: clip-browser query helpers — the data behind the `/clips` browser's
// three scopes. Each returns serialized clip rows (parent-replay matchup + clip
// fields), newest first, capped, with identities anonymized per the parent
// replay's visibility. The clip list APIs and the `/clips` RSC both call these
// so the wire shape can't drift.
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { getDb } from './db';
import { clips, replays, users, replayParticipants, replayAltPayload } from './schema';
import { type AuthContext, canMutateClip } from './replayPermissions';
import { canViewReplayIdentities } from './altPerspective';
import { surfacedReplaySlugs } from './teamSurface';
import { isSampleReplaySlug } from './sampleReplays';
import { serializeClipRow, type SerializedClipRow } from './clipRow';

const LIMIT = 100;

type ClipJoin = { clip: typeof clips.$inferSelect; replay: any; creatorName: string | null };

// Shared tail: resolve per-replay identity entitlement (deduped) and serialize.
async function finishRows(rows: ClipJoin[], ctx: AuthContext): Promise<SerializedClipRow[]> {
  const entByReplay = new Map<string, boolean>();
  for (const { replay } of rows) {
    if (entByReplay.has(replay.slug)) continue;
    const ent = isSampleReplaySlug(replay.slug) ? false : await canViewReplayIdentities(replay, ctx);
    entByReplay.set(replay.slug, ent);
  }
  return rows.map(({ clip, replay, creatorName }) =>
    serializeClipRow(clip, replay, {
      anonymize: !entByReplay.get(replay.slug),
      creatorName: creatorName ?? null,
      isMine: !!ctx.sessionUserId && clip.userId === ctx.sessionUserId,
      canDelete: canMutateClip(clip, replay, ctx),
    }),
  );
}

function baseSelect() {
  return getDb()
    .select({ clip: clips, replay: replays, creatorName: users.name })
    .from(clips)
    .innerJoin(replays, eq(replays.slug, clips.replaySlug))
    .leftJoin(users, eq(users.id, clips.userId));
}

// Clips the caller CREATED — by signed-in account or by install token.
export async function myCreatedClips(ctx: AuthContext): Promise<SerializedClipRow[]> {
  const conds = [];
  if (ctx.sessionUserId) conds.push(eq(clips.userId, ctx.sessionUserId));
  if (ctx.installToken) conds.push(eq(clips.createdBy, ctx.installToken));
  if (conds.length === 0) return [];
  const rows = await baseSelect()
    .where(or(...conds))
    .orderBy(desc(clips.createdAt))
    .limit(LIMIT);
  return finishRows(rows as ClipJoin[], ctx);
}

// Clips OTHERS made of replays the caller recorded (uploaded / participated /
// recorded the alt side) — excludes the caller's own clips (those are "My
// Clips"). Signed-in only.
export async function clipsOnMyReplays(ctx: AuthContext): Promise<SerializedClipRow[]> {
  const me = ctx.sessionUserId;
  if (!me) return [];
  const db = getDb();
  const [own, part, alt] = await Promise.all([
    db.select({ slug: replays.slug }).from(replays).where(eq(replays.userId, me)),
    db.select({ slug: replayParticipants.replaySlug }).from(replayParticipants).where(eq(replayParticipants.userId, me)),
    db.select({ slug: replayAltPayload.replaySlug }).from(replayAltPayload).where(eq(replayAltPayload.altUserId, me)),
  ]);
  const mineSlugs = Array.from(new Set([...own, ...part, ...alt].map((r) => r.slug)));
  if (mineSlugs.length === 0) return [];
  const rows = (await baseSelect()
    .where(inArray(clips.replaySlug, mineSlugs))
    .orderBy(desc(clips.createdAt))
    .limit(LIMIT)) as ClipJoin[];
  // Exclude clips I authored (null-userId clips stay — they're someone else's
  // anonymous clip; `ne` would drop them since NULL != me is NULL).
  const others = rows.filter((r) => r.clip.userId !== me);
  return finishRows(others, ctx);
}

// Clips on replays surfaced to a team (explicit share OR a tag scoped to the
// team). The route gates membership; this just scopes + serializes.
export async function teamClips(teamSlug: string, ctx: AuthContext): Promise<SerializedClipRow[]> {
  const surfaceSlugs = await surfacedReplaySlugs([teamSlug]);
  if (surfaceSlugs.length === 0) return [];
  const rows = (await baseSelect()
    .where(inArray(clips.replaySlug, surfaceSlugs))
    .orderBy(desc(clips.createdAt))
    .limit(LIMIT)) as ClipJoin[];
  return finishRows(rows, ctx);
}
