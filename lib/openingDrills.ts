// B221: server-side query logic for Team Opening Drills.
//
// Scoping model (the load-bearing part — see BACKLOG B221):
//   • The POOL is derived from replays SHARED TO THE TEAM (replay_team_shares,
//     the existing boundary) that have an extracted opening. Encrypted replays
//     never have openings (ADR 0010).
//   • RESPONSES are stored team-agnostic (opening_responses keyed replay+user)
//     and scoped at READ time: a viewer sees the responses of members of any
//     team they share with the replay; the replay owner sees all (B131
//     analog). Membership is re-validated on every read.
//   • Identity is quiz-anonymized in the POOL payload by default (no
//     usernames, no owner name). Reveal data (the recorded decision + who) is
//     only serialized for viewers who ANSWERED or own the replay.

import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import {
  cards,
  openingResponses,
  replayOpenings,
  replays,
  replayTeamShares,
  tags,
  teamMembers,
  users,
  type ReplayOpening,
} from './schema';
import { resolveBaseIdentities, type BaseIdentity } from './baseIdentity';

export interface OpeningCardRef {
  id: string; // SET_NNN
  name: string | null;
  cost: number | null;
  aspects: string[] | null;
  type: string | null;
  set: string;
  number: number;
}

export interface OpeningResponseView {
  userId: string;
  name: string | null;
  decision: 'keep' | 'mulligan';
  resourced: string[];
  createdAt: string;
}

const cardRef = (id: string, byId: Map<string, any>): OpeningCardRef => {
  const [set, num] = id.split('_');
  const row = byId.get(id);
  return {
    id,
    name: row?.name ?? null,
    cost: row?.cost ?? null,
    aspects: row?.aspects ?? null,
    type: row?.type ?? null,
    set,
    number: Number(num),
  };
};

// Catalog enrichment for a set of cardIds (names/costs/aspects for the quiz
// UI; art URLs are derived client-side from set+number via cardImageUrl).
export async function cardRefs(ids: string[]): Promise<Map<string, OpeningCardRef>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();
  const rows = await getDb().select().from(cards).where(inArray(cards.cardId, unique));
  const byId = new Map(rows.map((r) => [r.cardId, r]));
  return new Map(unique.map((id) => [id, cardRef(id, byId)]));
}

// The responses on a replay's opening that THIS viewer may see: members of
// any team the viewer shares with the replay (+ always their own response);
// the replay owner sees all. Returns [] for viewers with no overlap.
export async function visibleResponses(
  replaySlug: string,
  viewerId: string,
  opts: { isOwner: boolean },
): Promise<OpeningResponseView[]> {
  const db = getDb();
  const all = await db
    .select({
      userId: openingResponses.userId,
      decision: openingResponses.decision,
      resourced: openingResponses.resourced,
      createdAt: openingResponses.createdAt,
      name: users.name,
    })
    .from(openingResponses)
    .leftJoin(users, eq(users.id, openingResponses.userId))
    .where(eq(openingResponses.replaySlug, replaySlug));
  if (all.length === 0) return [];

  let eligible: Set<string> | null = null; // null = all (owner)
  if (!opts.isOwner) {
    const [shares, mine] = await Promise.all([
      db
        .select({ teamSlug: replayTeamShares.teamSlug })
        .from(replayTeamShares)
        .where(eq(replayTeamShares.replaySlug, replaySlug)),
      db
        .select({ teamSlug: teamMembers.teamSlug })
        .from(teamMembers)
        .where(eq(teamMembers.userId, viewerId)),
    ]);
    const shared = new Set(shares.map((s) => s.teamSlug));
    const overlap = mine.map((m) => m.teamSlug).filter((t) => shared.has(t));
    eligible = new Set([viewerId]);
    if (overlap.length > 0) {
      const members = await db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(inArray(teamMembers.teamSlug, overlap));
      for (const m of members) eligible.add(m.userId);
    }
  }

  return all
    .filter((r) => !eligible || eligible.has(r.userId))
    .map((r) => ({
      userId: r.userId,
      name: r.name ?? null,
      decision: r.decision as 'keep' | 'mulligan',
      resourced: (r.resourced as string[]) ?? [],
      createdAt: r.createdAt.toISOString(),
    }));
}

export interface OpeningPoolItem {
  replaySlug: string;
  createdAt: string;
  // Matchup context, RECORDER POV — no usernames (quiz anonymity).
  ownLeader: any | null;
  ownBase: any | null;
  oppLeader: any | null;
  oppBase: any | null;
  // Functional base identity (lib/baseIdentity) — what base FILTERS key on:
  // vanilla and force-pair bases group; unique bases stay unique.
  ownBaseKind: BaseIdentity | null;
  oppBaseKind: BaseIdentity | null;
  format: string | null;
  wentFirst: boolean | null;
  // Viewer state
  mine: boolean; // viewer recorded this game (uploader view; excluded from the quiz queue client-side)
  answered: boolean;
  responseCount: number; // visible-team responses
  commentCount: number; // tags anchored at the opening's decision frames
  // Reveal-gated aggregate (only when answered or mine): did the visible
  // responses agree with each other and the recorded decision?
  recordedDecision?: 'keep' | 'mulligan';
  keepCount?: number;
  mulliganCount?: number;
  // True when every responder who made the RECORDED decision also picked the
  // exact recorded resources — i.e. the team agrees on decision AND picks.
  // False when the decision agrees but at least one pick set differs. Only
  // set alongside the tallies (answered/mine).
  resourcesUnanimous?: boolean;
  // The viewer's own outcome (answered items only) — drives the compact
  // outcome glyph: their decision + how many of their 2 picks matched.
  myDecision?: 'keep' | 'mulligan';
  myAnsweredAt?: string;
  // Karabast usernames (answered/own items only — identity is part of the
  // reveal): the recorder's side and their opponent's.
  usernames?: { own: string | null; opp: string | null };
  // 0..2 multiset overlap with the recorded picks — or null when the picks
  // aren't comparable (you kept, they mulliganed: different hands).
  myPickMatches?: number | null;
  // Coaching mode / own items: identity, only when requested or mine.
  recorder?: { userId: string | null; name: string | null };
}

// The drill pool for one team. Identity rule: `recorder` is present only on
// the viewer's own items, or for every item when `withRecorder` (the teammate
// filter is active — filtering by a person inherently reveals identity).
export async function openingPoolForTeam(
  teamSlug: string,
  viewerId: string,
  opts: { withRecorder?: boolean } = {},
): Promise<OpeningPoolItem[]> {
  const db = getDb();
  const rows = await db
    .select({ replay: replays, opening: replayOpenings, ownerName: users.name })
    .from(replayTeamShares)
    .innerJoin(replays, eq(replays.slug, replayTeamShares.replaySlug))
    .innerJoin(replayOpenings, eq(replayOpenings.replaySlug, replayTeamShares.replaySlug))
    .leftJoin(users, eq(users.id, replays.userId))
    .where(eq(replayTeamShares.teamSlug, teamSlug));
  if (rows.length === 0) return [];

  const slugs = rows.map((r) => r.replay.slug);

  // Which items has the viewer answered? Plus THIS TEAM's members' response
  // tallies (the pool is a team surface — the distribution shown is the
  // team's, not the union across the viewer's other teams).
  const members = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamSlug, teamSlug));
  const memberIds = new Set(members.map((m) => m.userId));
  const responses = await db
    .select({
      replaySlug: openingResponses.replaySlug,
      userId: openingResponses.userId,
      decision: openingResponses.decision,
      resourced: openingResponses.resourced,
      createdAt: openingResponses.createdAt,
    })
    .from(openingResponses)
    .where(inArray(openingResponses.replaySlug, slugs));

  // Comment counts: tags pinned at either decision frame of the opening.
  const frameBySlug = new Map(rows.map((r) => [r.replay.slug, r.opening]));
  const tagRows = await db
    .select({ replaySlug: tags.replaySlug, frameIndex: tags.frameIndex })
    .from(tags)
    .where(inArray(tags.replaySlug, slugs));
  const commentCounts = new Map<string, number>();
  for (const t of tagRows) {
    const o = frameBySlug.get(t.replaySlug);
    if (!o) continue;
    if (t.frameIndex === o.mulliganFrameIndex || t.frameIndex === o.resourceFrameIndex) {
      commentCounts.set(t.replaySlug, (commentCounts.get(t.replaySlug) ?? 0) + 1);
    }
  }

  // One batched identity resolve for every base in the pool (2 queries).
  const baseRefs: any[] = [];
  for (const r of rows) {
    const ps = Array.isArray(r.replay.players) ? (r.replay.players as any[]) : [];
    for (const p of ps) if (p?.base) baseRefs.push(p.base);
  }
  const baseIdentities = await resolveBaseIdentities(baseRefs);
  const kindOf = (base: any): BaseIdentity | null => {
    if (!base?.set || base?.number == null) return null;
    const n = Number(base.number);
    const id = `${base.set}_${Number.isFinite(n) ? String(n).padStart(3, '0') : String(base.number)}`;
    return baseIdentities.get(id) ?? null;
  };

  const items = rows.map(({ replay, opening, ownerName }) => {
    const mine = !!replay.userId && replay.userId === viewerId;
    const teamResponses = responses.filter(
      (r) => r.replaySlug === replay.slug && memberIds.has(r.userId),
    );
    const answered = teamResponses.some((r) => r.userId === viewerId);

    const players = Array.isArray(replay.players) ? (replay.players as any[]) : [];
    const own = players.find((p) => p?.id === opening.recorderId) ?? null;
    const opp = players.find((p) => p?.id !== opening.recorderId) ?? null;
    const stripName = (side: any, key: 'leader' | 'base') => side?.[key] ?? null;

    const item: OpeningPoolItem = {
      replaySlug: replay.slug,
      createdAt: replay.createdAt instanceof Date ? replay.createdAt.toISOString() : String(replay.createdAt),
      ownLeader: stripName(own, 'leader'),
      ownBase: stripName(own, 'base'),
      oppLeader: stripName(opp, 'leader'),
      oppBase: stripName(opp, 'base'),
      ownBaseKind: kindOf(own?.base),
      oppBaseKind: kindOf(opp?.base),
      format: (replay.match as any)?.gameFormat ?? null,
      wentFirst: opening.wentFirst,
      mine,
      answered,
      responseCount: teamResponses.length,
      commentCount: commentCounts.get(replay.slug) ?? 0,
    };
    // Reveal-gated aggregate: never leak the recorded decision (or the tally,
    // which implies it) to someone who hasn't answered yet.
    if (answered || mine) {
      item.recordedDecision = opening.decision as 'keep' | 'mulligan';
      item.keepCount = teamResponses.filter((r) => r.decision === 'keep').length;
      item.mulliganCount = teamResponses.filter((r) => r.decision === 'mulligan').length;
      // Resource agreement: responders who made the RECORDED decision picked
      // from the same hand as the recorder, so their picks compare directly to
      // opening.resourced. Consensus needs the decision AND both picks.
      const recordedPicks = (opening.resourced as string[]) ?? [];
      const decisionAgreers = teamResponses.filter((r) => r.decision === opening.decision);
      item.resourcesUnanimous = decisionAgreers.every((r) => {
        const picks = (r.resourced as string[]) ?? [];
        if (picks.length !== recordedPicks.length) return false;
        const pool = [...recordedPicks];
        for (const id of picks) {
          const at = pool.indexOf(id);
          if (at < 0) return false;
          pool.splice(at, 1);
        }
        return true;
      });
      // Identity is part of the reveal — answered rows may show who played.
      item.usernames = { own: own?.username ?? null, opp: opp?.username ?? null };
      const mineResp = teamResponses.find((r) => r.userId === viewerId);
      if (mineResp) {
        item.myDecision = mineResp.decision as 'keep' | 'mulligan';
        item.myAnsweredAt = mineResp.createdAt.toISOString();
        // Comparable only when both picked from the SAME hand: a keep answer
        // against a recorded mulligan lives on the dealt hand while their
        // picks live on the redraw. LEGACY answers (pre pick-first flow)
        // sourced keep-picks from the redraw — those ARE comparable.
        const mapsOntoDealt = (() => {
          const pool = [...((opening.dealtHand as string[]) ?? [])];
          for (const id of (mineResp.resourced as string[]) ?? []) {
            const at = pool.indexOf(id);
            if (at < 0) return false;
            pool.splice(at, 1);
          }
          return true;
        })();
        const comparable = !(mineResp.decision === 'keep' && opening.decision === 'mulligan' && mapsOntoDealt);
        if (!comparable) {
          item.myPickMatches = null;
        } else {
          // Multiset overlap of their picks vs the recorded picks (dup-safe).
          const pool = [...((opening.resourced as string[]) ?? [])];
          let matches = 0;
          for (const id of (mineResp.resourced as string[]) ?? []) {
            const at = pool.indexOf(id);
            if (at >= 0) { pool.splice(at, 1); matches++; }
          }
          item.myPickMatches = matches;
        }
      }
    }
    if (mine || answered || opts.withRecorder) {
      item.recorder = { userId: replay.userId ?? null, name: ownerName ?? null };
    }
    return item;
  });

  // Unanswered-first (quiz queue), then newest. "Mine" items sort by date
  // among the answered — the client separates them into the uploader view.
  return items.sort((a, b) => {
    const aq = a.answered || a.mine ? 1 : 0;
    const bq = b.answered || b.mine ? 1 : 0;
    if (aq !== bq) return aq - bq;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

// Entitlement for the item detail + response POST: the replay owner, or a
// member of any team the replay is shared to. (Membership re-validated per
// request — the boundary.)
export async function openingEntitlement(
  replaySlug: string,
  viewerId: string,
): Promise<{ replay: typeof replays.$inferSelect; opening: ReplayOpening; isOwner: boolean } | null> {
  const db = getDb();
  const [row] = await db
    .select({ replay: replays, opening: replayOpenings })
    .from(replays)
    .innerJoin(replayOpenings, eq(replayOpenings.replaySlug, replays.slug))
    .where(eq(replays.slug, replaySlug));
  if (!row) return null;
  const isOwner = !!row.replay.userId && row.replay.userId === viewerId;
  if (isOwner) return { ...row, isOwner };
  const shared = await db
    .select({ teamSlug: replayTeamShares.teamSlug })
    .from(replayTeamShares)
    .innerJoin(
      teamMembers,
      and(eq(teamMembers.teamSlug, replayTeamShares.teamSlug), eq(teamMembers.userId, viewerId)),
    )
    .where(eq(replayTeamShares.replaySlug, replaySlug));
  if (shared.length === 0) return null;
  return { ...row, isOwner };
}
