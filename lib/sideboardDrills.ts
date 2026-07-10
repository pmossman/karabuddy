// B227: the Sideboarding drill pool + entitlement + response scoping — the
// sibling of lib/openingDrills. A "sideboard decision" is a Bo3 transition
// (replay_sideboards, keyed by the game N+1 replay); teammates quiz what they'd
// swap, then compare to the recorder's actual swap + the team.
//
// Anonymity + read-scope rules are identical to openings: pool items are
// quiz-anonymized (no recorder identity until answered/mine), and a viewer sees
// OTHERS' responses only for teammates they share the replay with (owner sees
// all). cardRefs is reused from openingDrills (one card catalog).

import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import {
  replays, replaySideboards, sideboardResponses, replayTeamShares, teamMembers, tags, users,
  type ReplaySideboard,
} from './schema';
import { resolveBaseIdentities, type BaseIdentity } from './baseIdentity';
import { cardIdFromSetNumber } from './cards';
import { multisetOverlap } from './multiset';

export interface SideboardResponseView {
  userId: string;
  name: string | null;
  swappedIn: string[];
  swappedOut: string[];
  createdAt: string;
  isMine: boolean;
}

// Responses on a sideboard the viewer may see: teammates on shared teams (+ own);
// the replay owner sees all. Mirrors openingDrills.visibleResponses.
export async function visibleSideboardResponses(
  replaySlug: string,
  viewerId: string,
  opts: { isOwner: boolean },
): Promise<SideboardResponseView[]> {
  const db = getDb();
  const all = await db
    .select({
      userId: sideboardResponses.userId,
      swappedIn: sideboardResponses.swappedIn,
      swappedOut: sideboardResponses.swappedOut,
      createdAt: sideboardResponses.createdAt,
      name: users.name,
    })
    .from(sideboardResponses)
    .leftJoin(users, eq(users.id, sideboardResponses.userId))
    .where(eq(sideboardResponses.replaySlug, replaySlug));
  if (all.length === 0) return [];

  let eligible: Set<string> | null = null; // null = all (owner)
  if (!opts.isOwner) {
    const [shares, mine] = await Promise.all([
      db.select({ teamSlug: replayTeamShares.teamSlug }).from(replayTeamShares).where(eq(replayTeamShares.replaySlug, replaySlug)),
      db.select({ teamSlug: teamMembers.teamSlug }).from(teamMembers).where(eq(teamMembers.userId, viewerId)),
    ]);
    const shared = new Set(shares.map((s) => s.teamSlug));
    const overlap = mine.map((m) => m.teamSlug).filter((t) => shared.has(t));
    eligible = new Set([viewerId]);
    if (overlap.length > 0) {
      const members = await db.select({ userId: teamMembers.userId }).from(teamMembers).where(inArray(teamMembers.teamSlug, overlap));
      for (const m of members) eligible.add(m.userId);
    }
  }

  return all
    .filter((r) => !eligible || eligible.has(r.userId))
    .map((r) => ({
      userId: r.userId,
      name: r.name ?? null,
      swappedIn: (r.swappedIn as string[]) ?? [],
      swappedOut: (r.swappedOut as string[]) ?? [],
      createdAt: r.createdAt.toISOString(),
      isMine: r.userId === viewerId,
    }));
}

export interface SideboardPoolItem {
  replaySlug: string;
  previousSlug: string;
  createdAt: string;
  gameNumber: number;
  // Matchup context, RECORDER POV — no usernames (quiz anonymity).
  ownLeader: any | null;
  ownBase: any | null;
  oppLeader: any | null;
  oppBase: any | null;
  ownBaseKind: BaseIdentity | null;
  oppBaseKind: BaseIdentity | null;
  format: string | null;
  wonPrevious: boolean | null;
  mine: boolean;
  answered: boolean;
  responseCount: number;
  commentCount: number;
  // Reveal-gated (answered or mine only) — never leak the recorded swap:
  recordedSwappedIn?: string[];
  recordedSwappedOut?: string[];
  usernames?: { own: string | null; opp: string | null };
  // Viewer's own outcome — how much of their swap matched the recorder's.
  myInMatches?: number; // copies brought-in that the recorder also brought in
  myOutMatches?: number;
  recorder?: { userId: string | null; name: string | null };
}

// The drill pool for one team. Same identity rule as openings.
export async function sideboardPoolForTeam(
  teamSlug: string,
  viewerId: string,
  opts: { withRecorder?: boolean } = {},
): Promise<SideboardPoolItem[]> {
  const db = getDb();
  const rows = await db
    .select({ replay: replays, side: replaySideboards, ownerName: users.name })
    .from(replayTeamShares)
    .innerJoin(replays, eq(replays.slug, replayTeamShares.replaySlug))
    .innerJoin(replaySideboards, eq(replaySideboards.replaySlug, replayTeamShares.replaySlug))
    .leftJoin(users, eq(users.id, replays.userId))
    .where(eq(replayTeamShares.teamSlug, teamSlug));
  if (rows.length === 0) return [];

  const slugs = rows.map((r) => r.replay.slug);
  const members = await db.select({ userId: teamMembers.userId }).from(teamMembers).where(eq(teamMembers.teamSlug, teamSlug));
  const memberIds = new Set(members.map((m) => m.userId));
  const responses = await db
    .select({ replaySlug: sideboardResponses.replaySlug, userId: sideboardResponses.userId, swappedIn: sideboardResponses.swappedIn, swappedOut: sideboardResponses.swappedOut })
    .from(sideboardResponses)
    .where(inArray(sideboardResponses.replaySlug, slugs));

  // Comments: tags on the (post-sideboard) replay near its start.
  const tagRows = await db.select({ replaySlug: tags.replaySlug, frameIndex: tags.frameIndex }).from(tags).where(inArray(tags.replaySlug, slugs));
  const commentCounts = new Map<string, number>();
  for (const t of tagRows) if (t.frameIndex <= 1) commentCounts.set(t.replaySlug, (commentCounts.get(t.replaySlug) ?? 0) + 1);

  const baseRefs: any[] = [];
  for (const r of rows) {
    const ps = Array.isArray(r.replay.players) ? (r.replay.players as any[]) : [];
    for (const p of ps) if (p?.base) baseRefs.push(p.base);
  }
  const baseIdentities = await resolveBaseIdentities(baseRefs);
  const kindOf = (base: any): BaseIdentity | null => {
    if (!base?.set || base?.number == null) return null;
    return baseIdentities.get(cardIdFromSetNumber(base.set, base.number)) ?? null;
  };

  const items = rows.map(({ replay, side, ownerName }) => {
    const mine = !!replay.userId && replay.userId === viewerId;
    const teamResponses = responses.filter((r) => r.replaySlug === replay.slug && memberIds.has(r.userId));
    const answered = teamResponses.some((r) => r.userId === viewerId);

    const players = Array.isArray(replay.players) ? (replay.players as any[]) : [];
    const own = players.find((p) => p?.id === side.recorderId) ?? null;
    const opp = players.find((p) => p?.id !== side.recorderId) ?? null;

    const item: SideboardPoolItem = {
      replaySlug: replay.slug,
      previousSlug: side.previousSlug,
      createdAt: replay.createdAt instanceof Date ? replay.createdAt.toISOString() : String(replay.createdAt),
      gameNumber: side.gameNumber,
      ownLeader: own?.leader ?? null,
      ownBase: own?.base ?? null,
      oppLeader: opp?.leader ?? null,
      oppBase: opp?.base ?? null,
      ownBaseKind: kindOf(own?.base),
      oppBaseKind: kindOf(opp?.base),
      format: (replay.match as any)?.gameFormat ?? null,
      wonPrevious: side.wonPrevious,
      mine,
      answered,
      responseCount: teamResponses.length,
      commentCount: commentCounts.get(replay.slug) ?? 0,
    };
    if (answered || mine) {
      item.recordedSwappedIn = (side.swappedIn as string[]) ?? [];
      item.recordedSwappedOut = (side.swappedOut as string[]) ?? [];
      item.usernames = { own: own?.username ?? null, opp: opp?.username ?? null };
      const mineResp = teamResponses.find((r) => r.userId === viewerId);
      if (mineResp) {
        item.myInMatches = multisetOverlap((mineResp.swappedIn as string[]) ?? [], item.recordedSwappedIn);
        item.myOutMatches = multisetOverlap((mineResp.swappedOut as string[]) ?? [], item.recordedSwappedOut);
      }
    }
    if (mine || answered || opts.withRecorder) {
      item.recorder = { userId: replay.userId ?? null, name: ownerName ?? null };
    }
    return item;
  });

  return items.sort((a, b) => {
    const aq = a.answered || a.mine ? 1 : 0;
    const bq = b.answered || b.mine ? 1 : 0;
    if (aq !== bq) return aq - bq;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

// Entitlement for the item detail + response POST (mirrors openingEntitlement).
export async function sideboardEntitlement(
  replaySlug: string,
  viewerId: string,
): Promise<{ replay: typeof replays.$inferSelect; side: ReplaySideboard; isOwner: boolean } | null> {
  const db = getDb();
  const [row] = await db
    .select({ replay: replays, side: replaySideboards })
    .from(replays)
    .innerJoin(replaySideboards, eq(replaySideboards.replaySlug, replays.slug))
    .where(eq(replays.slug, replaySlug));
  if (!row) return null;
  const isOwner = !!row.replay.userId && row.replay.userId === viewerId;
  if (isOwner) return { ...row, isOwner };
  const shared = await db
    .select({ teamSlug: replayTeamShares.teamSlug })
    .from(replayTeamShares)
    .innerJoin(teamMembers, and(eq(teamMembers.teamSlug, replayTeamShares.teamSlug), eq(teamMembers.userId, viewerId)))
    .where(eq(replayTeamShares.replaySlug, replaySlug));
  if (shared.length === 0) return null;
  return { ...row, isOwner };
}
