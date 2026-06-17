import { sql, count, desc, eq, gte } from 'drizzle-orm';
import { getDb } from './db';
import { users, replays, teams, teamMembers, tournaments, clips, tags } from './schema';

// B157: aggregate metrics for the internal admin dashboard. Admin-only + low
// traffic, so this runs straight in the /admin RSC. Kept as a testable function.

export interface DayPoint { day: string; n: number }

export interface AdminMetrics {
  counters: {
    users: number; games: number; teams: number; tournaments: number; clips: number; tags: number;
    usersLast7: number; gamesLast7: number; teamsLast7: number;
  };
  signupsByDay: DayPoint[];      // last 30 days, zero-filled
  gamesByDay: DayPoint[];        // last 30 days, zero-filled
  cumulativeUsers: DayPoint[];   // last 30 days, running total
  topTeams: { slug: string; name: string; members: number }[];
  recentUsers: { name: string | null; createdAt: string }[];
  generatedAt: string;
}

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);

// Build a continuous, zero-filled day series (oldest → newest) of length `days`.
function zeroFill(rows: { day: string; n: number }[], days: number, now: Date): DayPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, num(r.n)]));
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(new Date(now.getTime() - i * DAY));
    out.push({ day: k, n: byDay.get(k) ?? 0 });
  }
  return out;
}

export async function loadAdminMetrics(now: Date = new Date()): Promise<AdminMetrics> {
  const db = getDb();
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since30 = new Date(now.getTime() - 29 * DAY); // inclusive 30-day window
  const since30Start = new Date(`${dayKey(since30)}T00:00:00.000Z`);

  const signupDay = sql<string>`to_char(date_trunc('day', ${users.createdAt}), 'YYYY-MM-DD')`;
  const gameDay = sql<string>`to_char(date_trunc('day', ${replays.createdAt}), 'YYYY-MM-DD')`;
  const memberCount = sql<number>`count(distinct ${teamMembers.userId})`;

  const c = (table: any) => db.select({ c: count() }).from(table).then((r) => num(r[0]?.c));
  const cSince = (table: any, col: any) =>
    db.select({ c: count() }).from(table).where(gte(col, since7)).then((r) => num(r[0]?.c));

  const [
    usersTotal, gamesTotal, teamsTotal, tournamentsTotal, clipsTotal, tagsTotal,
    usersLast7, gamesLast7, teamsLast7,
    signupRows, gameRows, topTeams, recentUserRows, usersBeforeWindow,
  ] = await Promise.all([
    c(users), c(replays), c(teams), c(tournaments), c(clips), c(tags),
    cSince(users, users.createdAt), cSince(replays, replays.createdAt), cSince(teams, teams.createdAt),
    db.select({ day: signupDay, n: count() }).from(users).where(gte(users.createdAt, since30Start)).groupBy(signupDay),
    db.select({ day: gameDay, n: count() }).from(replays).where(gte(replays.createdAt, since30Start)).groupBy(gameDay),
    db.select({ slug: teams.slug, name: teams.name, members: memberCount })
      .from(teams).leftJoin(teamMembers, eq(teamMembers.teamSlug, teams.slug))
      .groupBy(teams.slug, teams.name).orderBy(desc(memberCount)).limit(10),
    db.select({ name: users.name, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt)).limit(10),
    db.select({ c: count() }).from(users).where(sql`${users.createdAt} < ${since30Start}`).then((r) => num(r[0]?.c)),
  ]);

  const signupsByDay = zeroFill(signupRows as any, 30, now);
  const gamesByDay = zeroFill(gameRows as any, 30, now);
  // Running total of users across the 30-day window (starting from the count
  // that existed before the window).
  let running = usersBeforeWindow;
  const cumulativeUsers = signupsByDay.map((p) => { running += p.n; return { day: p.day, n: running }; });

  return {
    counters: {
      users: usersTotal, games: gamesTotal, teams: teamsTotal,
      tournaments: tournamentsTotal, clips: clipsTotal, tags: tagsTotal,
      usersLast7, gamesLast7, teamsLast7,
    },
    signupsByDay,
    gamesByDay,
    cumulativeUsers,
    topTeams: (topTeams as any[]).map((t) => ({ slug: t.slug, name: t.name, members: num(t.members) })),
    recentUsers: (recentUserRows as any[]).map((u) => ({
      name: u.name ?? null,
      createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt),
    })),
    generatedAt: now.toISOString(),
  };
}
