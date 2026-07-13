import { sql, count, desc, eq, gte, and } from 'drizzle-orm';
import { getDb } from './db';
import {
  users, replays, teams, teamMembers, tournaments, clips, tags,
  replayReviews, replayTeamShares, openingResponses, sideboardResponses, extensionTokens,
} from './schema';

// B157 / B230-followup: aggregate metrics for the internal admin dashboard.
// Admin-only + low traffic, so this runs straight in the /admin RSC. Covers the
// full signup history (weekly), 90-day daily activity + active users, and
// per-feature adoption + trend so we can see which features matter.

export interface DayPoint { day: string; n: number }
export interface WeekPoint { week: string; n: number }
export interface ActivityPoint { day: string; signups: number; games: number; active: number }
export interface FeatureUsage { key: string; label: string; total: number; last7: number; last30: number; weekly: WeekPoint[] }

export interface AdminMetrics {
  counters: Record<string, number>;   // totals per entity/feature
  deltas: Record<string, number>;     // last-30-day counts for the headline counters
  signupsWeekly: WeekPoint[];         // ALL-TIME weekly signups
  signupsCumulative: WeekPoint[];     // ALL-TIME running total
  activity: ActivityPoint[];          // last 90 days: signups / games / active users per day
  activeUsers: { dau: number; wau: number; mau: number };
  features: FeatureUsage[];
  topTeams: { slug: string; name: string; members: number; shares: number; private: boolean }[];
  recentSignups: { name: string | null; createdAt: string }[];
  generatedAt: string;
}

const DAY = 86_400_000;
const num = (v: unknown) => Number(v ?? 0);
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

export async function loadAdminMetrics(now: Date = new Date()): Promise<AdminMetrics> {
  const db = getDb();
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since90Start = new Date(`${dayKey(new Date(now.getTime() - 89 * DAY))}T00:00:00.000Z`);
  const since16w = new Date(now.getTime() - 16 * 7 * DAY);

  const c = (table: any, where?: any) => db.select({ c: count() }).from(table).where(where).then((r) => num(r[0]?.c));

  // Per-feature adoption: total + last7 + last30 + weekly (last 16 weeks). One
  // helper so adding a feature is one row below.
  const FEATURES: { key: string; label: string; table: any; ts: any }[] = [
    { key: 'comments', label: 'Comments', table: tags, ts: tags.createdAt },
    { key: 'reviews', label: 'Reviews', table: replayReviews, ts: replayReviews.reviewedAt },
    { key: 'shares', label: 'Team shares', table: replayTeamShares, ts: replayTeamShares.sharedAt },
    { key: 'clips', label: 'Clips', table: clips, ts: clips.createdAt },
    { key: 'openings', label: 'Opening drills', table: openingResponses, ts: openingResponses.createdAt },
    { key: 'sideboards', label: 'Sideboard drills', table: sideboardResponses, ts: sideboardResponses.createdAt },
    { key: 'tournaments', label: 'Tournaments', table: tournaments, ts: tournaments.createdAt },
    { key: 'joins', label: 'Team joins', table: teamMembers, ts: teamMembers.joinedAt },
    { key: 'installs', label: 'Extension installs', table: extensionTokens, ts: extensionTokens.linkedAt },
  ];
  const featureStats = async (f: (typeof FEATURES)[number]): Promise<FeatureUsage> => {
    const wk = sql<string>`to_char(date_trunc('week', ${f.ts}), 'YYYY-MM-DD')`;
    const [total, last7, last30, weekRows] = await Promise.all([
      c(f.table),
      c(f.table, gte(f.ts, since7)),
      c(f.table, gte(f.ts, since30)),
      db.select({ week: wk, n: count() }).from(f.table).where(gte(f.ts, since16w)).groupBy(wk).orderBy(wk),
    ]);
    return { key: f.key, label: f.label, total, last7, last30, weekly: (weekRows as any[]).map((r) => ({ week: r.week, n: num(r.n) })) };
  };

  const signupWeek = sql<string>`to_char(date_trunc('week', ${users.createdAt}), 'YYYY-MM-DD')`;
  const signupDay = sql<string>`to_char(date_trunc('day', ${users.createdAt}), 'YYYY-MM-DD')`;
  const gameDay = sql<string>`to_char(date_trunc('day', ${replays.createdAt}), 'YYYY-MM-DD')`;

  // Active users = distinct accounts that did SOMETHING (uploaded, commented,
  // drilled) — one union over the user-attributed activity tables.
  const activeUnion = (since: Date) => sql`
    select date_trunc('day', created_at) d, user_id u from ${replays} where user_id is not null and created_at >= ${since}
    union all select date_trunc('day', created_at), user_id from ${tags} where user_id is not null and created_at >= ${since}
    union all select date_trunc('day', created_at), user_id from ${openingResponses} where user_id is not null and created_at >= ${since}
    union all select date_trunc('day', created_at), user_id from ${sideboardResponses} where user_id is not null and created_at >= ${since}`;
  const activeInWindow = (since: Date) => db.execute(sql`select count(distinct u)::int n from (${activeUnion(since)}) t`).then((r: any) => num((r.rows ?? r)[0]?.n));
  const memberCount = sql<number>`count(distinct ${teamMembers.userId})`;
  const shareCount = sql<number>`count(distinct ${replayTeamShares.replaySlug})`;

  const [
    usersTotal, gamesTotal, teamsTotal, privateTeamsTotal,
    usersLast30, gamesLast30, teamsLast30,
    signupWeekRows, signupDayRows, gameDayRows, activeRows,
    dau, wau, mau, features, topTeamRows, recentUserRows,
  ] = await Promise.all([
    c(users), c(replays), c(teams), c(teams, eq(teams.privateMode, true)),
    c(users, gte(users.createdAt, since30)), c(replays, gte(replays.createdAt, since30)), c(teams, gte(teams.createdAt, since30)),
    db.select({ week: signupWeek, n: count() }).from(users).groupBy(signupWeek).orderBy(signupWeek),
    db.select({ day: signupDay, n: count() }).from(users).where(gte(users.createdAt, since90Start)).groupBy(signupDay),
    db.select({ day: gameDay, n: count() }).from(replays).where(gte(replays.createdAt, since90Start)).groupBy(gameDay),
    db.execute(sql`select to_char(d, 'YYYY-MM-DD') dd, count(distinct u)::int n from (${activeUnion(since90Start)}) t group by d`),
    activeInWindow(new Date(now.getTime() - DAY)), activeInWindow(since7), activeInWindow(since30),
    Promise.all(FEATURES.map(featureStats)),
    db.select({ slug: teams.slug, name: teams.name, private: teams.privateMode, members: memberCount, shares: shareCount })
      .from(teams).leftJoin(teamMembers, eq(teamMembers.teamSlug, teams.slug)).leftJoin(replayTeamShares, eq(replayTeamShares.teamSlug, teams.slug))
      .groupBy(teams.slug, teams.name, teams.privateMode).orderBy(desc(shareCount)).limit(12),
    db.select({ name: users.name, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt)).limit(15),
  ]);

  const signupsWeekly = (signupWeekRows as any[]).map((r) => ({ week: r.week, n: num(r.n) }));
  let running = 0;
  const signupsCumulative = signupsWeekly.map((p) => { running += p.n; return { week: p.week, n: running }; });

  const sBy = new Map((signupDayRows as any[]).map((r) => [r.day, num(r.n)]));
  const gBy = new Map((gameDayRows as any[]).map((r) => [r.day, num(r.n)]));
  const aBy = new Map((((activeRows as any).rows ?? activeRows) as any[]).map((r) => [r.dd, num(r.n)]));
  const activity: ActivityPoint[] = [];
  for (let i = 89; i >= 0; i--) {
    const k = dayKey(new Date(now.getTime() - i * DAY));
    activity.push({ day: k, signups: sBy.get(k) ?? 0, games: gBy.get(k) ?? 0, active: (aBy.get(k) as number) ?? 0 });
  }

  const feat = (k: string) => features.find((f) => f.key === k)?.total ?? 0;
  return {
    counters: {
      users: usersTotal, games: gamesTotal, teams: teamsTotal, privateTeams: privateTeamsTotal,
      tournaments: feat('tournaments'), clips: feat('clips'), comments: feat('comments'),
      reviews: feat('reviews'), shares: feat('shares'), openings: feat('openings'),
      sideboards: feat('sideboards'), installs: feat('installs'),
    },
    deltas: { users: usersLast30, games: gamesLast30, teams: teamsLast30 },
    signupsWeekly, signupsCumulative, activity,
    activeUsers: { dau, wau, mau },
    features,
    topTeams: (topTeamRows as any[]).map((t) => ({ slug: t.slug, name: t.name, members: num(t.members), shares: num(t.shares), private: !!t.private })),
    recentSignups: (recentUserRows as any[]).map((u) => ({ name: u.name ?? null, createdAt: iso(u.createdAt) })),
    generatedAt: now.toISOString(),
  };
}
