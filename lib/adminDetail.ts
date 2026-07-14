import { sql, count, desc, eq, and, isNotNull, gte } from 'drizzle-orm';
import { getDb } from './db';
import {
  users, teams, replays, tags, replayReviews, replayTeamShares, clips,
  openingResponses, sideboardResponses, tournaments, teamMembers, extensionTokens,
} from './schema';

// B157-followup: on-demand drill-down for the admin dashboard. The overview
// (lib/adminMetrics) is the headline; these are the "click into it" bundles,
// fetched lazily per expanded row so the RSC stays cheap. Admin-gated at the
// route. Read-only aggregates — no PII leaves beyond name/email (admin-only).

const num = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v));
const CNT = sql<number>`count(*)::int`;

// Per-feature source config: table, timestamp, the acting account, the team
// column when team-scoped, and an optional `filter` scoping to a subset (private
// replays = encrypted). Mirrors lib/adminMetrics FEATURES.
// `team` joins teams.slug (team-scoped events); `teamKey` joins teams.team_key_id
// (encrypted replays link to their team only via the E2EE key id, not a slug).
type FeatureCfg = { label: string; table: any; ts: any; actor: any; team?: any; teamKey?: any; filter?: any };
const FEATURE: Record<string, FeatureCfg> = {
  comments: { label: 'Comments', table: tags, ts: tags.createdAt, actor: tags.userId },
  reviews: { label: 'Reviews', table: replayReviews, ts: replayReviews.reviewedAt, actor: replayReviews.reviewerUserId, team: replayReviews.teamSlug },
  shares: { label: 'Team shares', table: replayTeamShares, ts: replayTeamShares.sharedAt, actor: replayTeamShares.sharedBy, team: replayTeamShares.teamSlug },
  clips: { label: 'Clips', table: clips, ts: clips.createdAt, actor: clips.userId },
  openings: { label: 'Opening drills', table: openingResponses, ts: openingResponses.createdAt, actor: openingResponses.userId },
  sideboards: { label: 'Sideboard drills', table: sideboardResponses, ts: sideboardResponses.createdAt, actor: sideboardResponses.userId },
  tournaments: { label: 'Tournaments', table: tournaments, ts: tournaments.createdAt, actor: tournaments.createdBy, team: tournaments.teamSlug },
  joins: { label: 'Team joins', table: teamMembers, ts: teamMembers.joinedAt, actor: teamMembers.userId, team: teamMembers.teamSlug },
  installs: { label: 'Extension installs', table: extensionTokens, ts: extensionTokens.linkedAt, actor: extensionTokens.userId },
  privateTeams: { label: 'Private teams', table: teams, ts: teams.createdAt, actor: teams.createdBy, filter: eq(teams.privateMode, true) },
  privateReplays: { label: 'Private replays', table: replays, ts: replays.createdAt, actor: replays.userId, teamKey: replays.teamKeyId, filter: eq(replays.encrypted, true) },
};
export const isFeatureKey = (k: string): boolean => k in FEATURE;

export interface FeatureDetail {
  key: string; label: string;
  weekly: { week: string; n: number }[];               // ALL-TIME weekly
  topUsers: { id: string | null; name: string | null; n: number }[];
  topTeams: { slug: string | null; name: string | null; n: number }[];
  recent: { when: string; actorId: string | null; actorName: string | null; team: string | null }[];
}

export async function featureDetail(key: string): Promise<FeatureDetail | null> {
  const cfg = FEATURE[key];
  if (!cfg) return null;
  const db = getDb();
  const wk = sql<string>`to_char(date_trunc('week', ${cfg.ts}), 'YYYY-MM-DD')`;
  const flt = cfg.filter;
  const w = (extra?: any) => (flt && extra ? and(extra, flt) : (extra ?? flt));

  const [weekRows, userRows, teamRows, recentRows] = await Promise.all([
    db.select({ week: wk, n: count() }).from(cfg.table).where(w()).groupBy(wk).orderBy(wk),
    db.select({ id: cfg.actor, name: users.name, n: CNT })
      .from(cfg.table).leftJoin(users, eq(users.id, cfg.actor))
      .where(w(isNotNull(cfg.actor))).groupBy(cfg.actor, users.name).orderBy(sql`count(*) desc`).limit(10),
    cfg.team
      ? db.select({ slug: cfg.team, name: teams.name, n: CNT })
          .from(cfg.table).leftJoin(teams, eq(teams.slug, cfg.team))
          .where(w()).groupBy(cfg.team, teams.name).orderBy(sql`count(*) desc`).limit(10)
      : cfg.teamKey
      // Encrypted replays link to their team via the key id; orphan keys (team
      // disabled private mode / rotated / deleted) resolve to a null team.
      ? db.select({ slug: teams.slug, name: teams.name, n: CNT })
          .from(cfg.table).leftJoin(teams, eq(teams.teamKeyId, cfg.teamKey))
          .where(w()).groupBy(teams.slug, teams.name).orderBy(sql`count(*) desc`).limit(10)
      : Promise.resolve([] as any[]),
    db.select({ when: cfg.ts, actorId: cfg.actor, actorName: users.name, ...(cfg.team ? { team: cfg.team } : {}) } as any)
      .from(cfg.table).leftJoin(users, eq(users.id, cfg.actor)).where(w()).orderBy(desc(cfg.ts)).limit(15),
  ]);

  return {
    key, label: cfg.label,
    weekly: (weekRows as any[]).map((r) => ({ week: r.week, n: num(r.n) })),
    topUsers: (userRows as any[]).map((r) => ({ id: r.id ?? null, name: r.name ?? null, n: num(r.n) })),
    topTeams: (teamRows as any[]).map((r) => ({ slug: r.slug ?? null, name: r.name ?? null, n: num(r.n) })),
    recent: (recentRows as any[]).map((r) => ({ when: iso(r.when), actorId: r.actorId ?? null, actorName: r.actorName ?? null, team: r.team ?? null })),
  };
}

export interface TeamDetail {
  slug: string; name: string; private: boolean; teamKeyId: string | null; privateReplays: number; createdAt: string;
  members: { id: string; name: string | null; role: string; joinedAt: string }[];
  featureCounts: { key: string; label: string; n: number }[];
  recentShares: { slug: string; name: string | null; when: string }[];
}

export async function teamDetail(slug: string): Promise<TeamDetail | null> {
  const db = getDb();
  const t = (await db.select().from(teams).where(eq(teams.slug, slug)).limit(1))[0];
  if (!t) return null;

  // Encrypted replays link to the team via its key id (not a slug). Only counts
  // while the key is current — a team that disabled private mode nulls its key,
  // so its old encrypted replays are no longer attributable here.
  const privateReplays = t.teamKeyId
    ? await db.select({ n: CNT }).from(replays).where(and(eq(replays.encrypted, true), eq(replays.teamKeyId, t.teamKeyId))).then((r: any) => num(r[0]?.n))
    : 0;

  // Member count is shown separately in the header stat, so no 'joins' row here
  // (it would just duplicate it — team_members has only current members).
  const teamScoped: [string, string, any, any][] = [
    ['shares', 'Team shares', replayTeamShares, replayTeamShares.teamSlug],
    ['reviews', 'Reviews', replayReviews, replayReviews.teamSlug],
    ['tournaments', 'Tournaments', tournaments, tournaments.teamSlug],
  ];

  const [memberRows, recentShareRows, ...countRows] = await Promise.all([
    db.select({ id: teamMembers.userId, name: users.name, role: teamMembers.role, joinedAt: teamMembers.joinedAt })
      .from(teamMembers).leftJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamSlug, slug)).orderBy(teamMembers.joinedAt),
    db.select({ slug: replayTeamShares.replaySlug, name: replays.displayName, when: replayTeamShares.sharedAt })
      .from(replayTeamShares).leftJoin(replays, eq(replays.slug, replayTeamShares.replaySlug))
      .where(eq(replayTeamShares.teamSlug, slug)).orderBy(desc(replayTeamShares.sharedAt)).limit(12),
    ...teamScoped.map(([, , table, col]) => db.select({ n: CNT }).from(table).where(eq(col, slug)).then((r: any) => num(r[0]?.n))),
  ]);

  return {
    slug: t.slug, name: t.name, private: !!t.privateMode, teamKeyId: t.teamKeyId ?? null, privateReplays, createdAt: iso(t.createdAt),
    members: (memberRows as any[]).map((m) => ({ id: m.id, name: m.name ?? null, role: m.role, joinedAt: iso(m.joinedAt) })),
    featureCounts: teamScoped.map(([key, label], i) => ({ key, label, n: countRows[i] as number })),
    recentShares: (recentShareRows as any[]).map((s) => ({ slug: s.slug, name: s.name ?? null, when: iso(s.when) })),
  };
}

export interface UserDetail {
  id: string; name: string | null; email: string | null; image: string | null;
  createdAt: string; lastActive: string | null;
  games: number;
  featureCounts: { key: string; label: string; n: number }[];
  teams: { slug: string; name: string; role: string; private: boolean }[];
  recentReplays: { slug: string; name: string | null; when: string }[];
  recentComments: { replaySlug: string; text: string; when: string }[];
}

export async function userDetail(id: string): Promise<UserDetail | null> {
  const db = getDb();
  const u = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!u) return null;

  // Per-feature counts where this account is the actor. Apply the feature's own
  // `filter` too (e.g. privateReplays = encrypted only, privateTeams = private
  // only) — without it these would count ALL of the user's replays/teams.
  const perFeature = Object.entries(FEATURE).map(([key, cfg]) =>
    db.select({ n: CNT }).from(cfg.table)
      .where(cfg.filter ? and(eq(cfg.actor, id), cfg.filter) : eq(cfg.actor, id))
      .then((r: any) => ({ key, label: cfg.label, n: num(r[0]?.n) })));

  const [games, lastActive, featureCounts, teamRows, recentReplayRows, recentCommentRows] = await Promise.all([
    db.select({ n: sql<number>`count(distinct ${replays.gameId})::int` }).from(replays).where(eq(replays.userId, id)).then((r) => num(r[0]?.n)),
    db.execute(sql`select max(ts) t from (
      select created_at ts from ${replays} where user_id = ${id}
      union all select created_at from ${tags} where user_id = ${id}
      union all select created_at from ${openingResponses} where user_id = ${id}
      union all select created_at from ${sideboardResponses} where user_id = ${id}) e`)
      .then((r: any) => (r.rows ?? r)[0]?.t ?? null),
    Promise.all(perFeature),
    db.select({ slug: teams.slug, name: teams.name, role: teamMembers.role, private: teams.privateMode })
      .from(teamMembers).innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
      .where(eq(teamMembers.userId, id)).orderBy(teamMembers.joinedAt),
    db.select({ slug: replays.slug, name: replays.displayName, when: replays.createdAt })
      .from(replays).where(and(eq(replays.userId, id), isNotNull(replays.userId))).orderBy(desc(replays.createdAt)).limit(12),
    db.select({ replaySlug: tags.replaySlug, text: tags.comment, when: tags.createdAt })
      .from(tags).where(eq(tags.userId, id)).orderBy(desc(tags.createdAt)).limit(12),
  ]);

  return {
    id: u.id, name: u.name ?? null, email: u.email ?? null, image: u.image ?? null,
    createdAt: iso(u.createdAt), lastActive: iso(lastActive),
    games,
    featureCounts: featureCounts.filter((f) => f.n > 0),
    teams: (teamRows as any[]).map((r) => ({ slug: r.slug, name: r.name, role: r.role, private: !!r.private })),
    recentReplays: (recentReplayRows as any[]).map((r) => ({ slug: r.slug, name: r.name ?? null, when: iso(r.when) })),
    recentComments: (recentCommentRows as any[]).filter((r) => r.text).map((r) => ({ replaySlug: r.replaySlug, text: r.text, when: iso(r.when) })),
  };
}
