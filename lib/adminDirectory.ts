import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { users, replays, tags, openingResponses, sideboardResponses, teamMembers, teams, replayTeamShares, replayReviews } from './schema';

// B157-followup: admin directories — browse/search ALL users and teams, each row
// linking to a dedicated detail page. Read-only aggregates; admin-gated at the
// route/layout. Sort keys come from a fixed allowlist (never user input) so the
// order-by fragment is injection-safe; the search term is parameterized.

const num = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
const rowsOf = (r: any): any[] => (r.rows ?? r) as any[];

export type UserSort = 'activity' | 'games' | 'signup' | 'name';
export interface UserRow {
  id: string; name: string | null; email: string | null; signup: string | null;
  games: number; activity: number; lastActive: string | null; teams: number;
}

export async function searchUsers(q = '', sort: UserSort = 'activity', limit = 200): Promise<UserRow[]> {
  const db = getDb();
  const term = q.trim();
  const like = `%${term}%`;
  const where = term ? sql`where (us.name ilike ${like} or us.email ilike ${like})` : sql``;
  const order = ({
    activity: sql`activity desc, games desc`,
    games: sql`games desc, activity desc`,
    signup: sql`us.created_at desc nulls last`,
    name: sql`lower(us.name) asc nulls last`,
  } as Record<UserSort, any>)[sort] ?? sql`activity desc`;

  const res = await db.execute(sql`
    select us.id id, us.name nm, us.email email, us.created_at signup,
      coalesce(g.games, 0)::int games,
      coalesce(a.activity, 0)::int activity,
      a.last_active last_active,
      coalesce(tm.teams, 0)::int teams
    from ${users} us
    left join (select user_id, count(distinct game_id) games from ${replays} where user_id is not null group by user_id) g on g.user_id = us.id
    left join (
      select u, count(*) activity, max(ts) last_active from (
        select user_id u, created_at ts from ${replays} where user_id is not null
        union all select user_id, created_at from ${tags} where user_id is not null
        union all select user_id, created_at from ${openingResponses} where user_id is not null
        union all select user_id, created_at from ${sideboardResponses} where user_id is not null
      ) e group by u
    ) a on a.u = us.id
    left join (select user_id, count(*) teams from ${teamMembers} group by user_id) tm on tm.user_id = us.id
    ${where}
    order by ${order}
    limit ${limit}`);

  return rowsOf(res).map((r) => ({
    id: r.id, name: r.nm ?? null, email: r.email ?? null, signup: iso(r.signup),
    games: num(r.games), activity: num(r.activity), lastActive: iso(r.last_active), teams: num(r.teams),
  }));
}

export type TeamSort = 'shares' | 'members' | 'created' | 'name';
export interface TeamRow {
  slug: string; name: string; private: boolean; createdAt: string | null;
  members: number; shares: number; reviews: number;
}

export async function searchTeams(q = '', sort: TeamSort = 'shares', limit = 200): Promise<TeamRow[]> {
  const db = getDb();
  const term = q.trim();
  const like = `%${term}%`;
  const where = term ? sql`where (t.name ilike ${like} or t.slug ilike ${like})` : sql``;
  const order = ({
    shares: sql`shares desc, members desc`,
    members: sql`members desc, shares desc`,
    created: sql`t.created_at desc nulls last`,
    name: sql`lower(t.name) asc`,
  } as Record<TeamSort, any>)[sort] ?? sql`shares desc`;

  const res = await db.execute(sql`
    select t.slug slug, t.name nm, t.private_mode priv, t.created_at created,
      coalesce(m.members, 0)::int members,
      coalesce(s.shares, 0)::int shares,
      coalesce(r.reviews, 0)::int reviews
    from ${teams} t
    left join (select team_slug, count(*) members from ${teamMembers} group by team_slug) m on m.team_slug = t.slug
    left join (select team_slug, count(distinct replay_slug) shares from ${replayTeamShares} group by team_slug) s on s.team_slug = t.slug
    left join (select team_slug, count(*) reviews from ${replayReviews} group by team_slug) r on r.team_slug = t.slug
    ${where}
    order by ${order}
    limit ${limit}`);

  return rowsOf(res).map((r) => ({
    slug: r.slug, name: r.nm, private: !!r.priv, createdAt: iso(r.created),
    members: num(r.members), shares: num(r.shares), reviews: num(r.reviews),
  }));
}
