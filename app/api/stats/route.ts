import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { teamMembers } from '@/lib/schema';
import { resolveUserIdFromRequest } from '@/lib/userResolution';
import { teamGameIds } from '@/lib/teamSurface';
import { getLeaderStats, getLeaderMatchups, getCardStats, getDecks, getDeckMatchups, getResourcingGames, getEntityReplays, type StatsScope, type CardEventKind } from '@/lib/statsQuery';
import { cachedRead, CACHE_TAGS } from '@/lib/cached';

// B101/P1 (ADR 0007): the Stats/Meta read API. One endpoint, dispatched by
// `type`, over a resolved + authorized `scope`:
//   GET /api/stats?type=leaders|matchups|cards|decks|resourcing&scope=personal|team
//       &team=<slug>&format=<f>&event=drawn|resourced|played|discarded
//
// Scope auth: personal needs a session; team needs membership (else 403).
// Global/community stats are intentionally NOT exposed — the feature is scoped
// to the individual + their teams.
//
// Perf (Neon compute): these are heavy GROUP BY aggregations over the fact tables
// and were run live on every request. The RESULT is fully determined by the query
// params + scope identity, so we cache it for 60s keyed by a compact descriptor
// (per-user for personal; shared per team+games for team). Auth/membership stays
// per-request; only the data read (incl. the teamGameIds resolution) is cached.

const CARD_EVENTS = ['drawn', 'resourced', 'played', 'discarded'];
const TYPES = new Set(['leaders', 'matchups', 'decks', 'resourcing', 'cards', 'replays']);

interface StatsKey {
  type: string;
  scopeKind: 'personal' | 'team';
  userId: string | null;
  teamSlug: string | null;
  games: string;
  format: string | null;
  byBase: boolean;
  event: CardEventKind;
  leader: string | null;
  baseId: string | null;
  baseAspect: string | null;
  opponentLeader: string | null;
}

const computeStats = cachedRead(
  async (k: StatsKey) => {
    let scope: StatsScope;
    if (k.scopeKind === 'personal') {
      scope = { kind: 'personal', userId: k.userId! };
    } else {
      const sets = await teamGameIds(k.teamSlug!);
      const restrictGameIds = k.games === 'external' ? sets.external : k.games === 'all' ? [...sets.internal, ...sets.external] : sets.internal;
      scope = { kind: 'team', teamSlug: k.teamSlug!, restrictGameIds, internalGameIds: sets.internal };
    }
    const opts = { scope, format: k.format, minGames: 1 };
    switch (k.type) {
      // Leader lens accepts a self-side leader/deck filter (drill-in: one leader's
      // record vs each opponent). The deck-vs-deck matrix (byBase) stays unfiltered.
      case 'matchups': return k.byBase ? getDeckMatchups(opts) : getLeaderMatchups({ ...opts, leader: k.leader, baseId: k.baseId, baseAspect: k.baseAspect });
      case 'decks': return getDecks({ ...opts, leader: k.leader });
      case 'resourcing': return getResourcingGames(opts);
      case 'cards': return getCardStats({ ...opts, event: k.event, leader: k.leader, baseId: k.baseId, baseAspect: k.baseAspect, opponentLeader: k.opponentLeader });
      case 'replays': return getEntityReplays({ ...opts, leader: k.leader, baseId: k.baseId, baseAspect: k.baseAspect, opponentLeader: k.opponentLeader });
      default: return getLeaderStats(opts);
    }
  },
  ['stats-data-v1'],
  { revalidate: 60, tags: [CACHE_TAGS.stats] },
);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get('type') || 'leaders';
  const scopeKind = url.searchParams.get('scope') || 'personal';
  const format = url.searchParams.get('format') || null;

  if (scopeKind !== 'personal' && scopeKind !== 'team') {
    return NextResponse.json({ ok: false, error: 'bad scope' }, { status: 400 });
  }
  if (!TYPES.has(type)) return NextResponse.json({ ok: false, error: 'bad type' }, { status: 400 });
  const event = (url.searchParams.get('event') || 'played') as CardEventKind;
  if (type === 'cards' && !CARD_EVENTS.includes(event)) return NextResponse.json({ ok: false, error: 'bad event' }, { status: 400 });

  // Resolve + authorize the scope.
  const userId = await resolveUserIdFromRequest(req);
  let teamSlug: string | null = null;
  let games = 'internal';
  if (scopeKind === 'personal') {
    if (!userId) return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });
  } else {
    teamSlug = url.searchParams.get('team');
    if (!teamSlug) return NextResponse.json({ ok: false, error: 'team slug required' }, { status: 400 });
    if (!userId) return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });
    const [member] = await getDb()
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamSlug, teamSlug)))
      .limit(1);
    if (!member) return NextResponse.json({ ok: false, error: 'not a team member' }, { status: 403 });
    // Team stats default to INTERNAL games (teammate-vs-teammate). `games=external`
    // = a member vs an outsider; `games=all` = both. (Dashboard sends none → internal.)
    games = url.searchParams.get('games') || 'internal';
  }

  const data = await computeStats({
    type, scopeKind, userId: userId ?? null, teamSlug, games, format,
    byBase: url.searchParams.get('byBase') === '1',
    event,
    leader: url.searchParams.get('leader') || null,
    baseId: url.searchParams.get('base') || null,
    baseAspect: url.searchParams.get('baseAspect') || null,
    opponentLeader: url.searchParams.get('vs') || null,
  });

  return NextResponse.json({ ok: true, scope: scopeKind, type, format, minGames: 1, data });
}
