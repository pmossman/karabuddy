import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { teamMembers } from '@/lib/schema';
import { resolveUserIdFromRequest } from '@/lib/userResolution';
import { getLeaderStats, getLeaderMatchups, getCardStats, getDecks, getDeckMatchups, getResourcingGames, type StatsScope, type CardEventKind } from '@/lib/statsQuery';

// B101/P1 (ADR 0007): the Stats/Meta read API. One endpoint, dispatched by
// `type`, over a resolved + authorized `scope`:
//   GET /api/stats?type=leaders|matchups|cards&scope=global|personal|team
//       &team=<slug>&format=<f>&event=drawn|resourced|played|discarded
//
// Scope auth: personal needs a session; team needs membership (else 403);
// global is open but min-N gated so no single game is identifiable. Queries
// run live against the fact tables for now — a rollup/cron (later P1) can
// back these same shapes when volume warrants.

// Privacy floor for the GLOBAL corpus: a leader/matchup/card row must clear
// this many games/observations before it's surfaced. Env-overridable.
const GLOBAL_MIN_GAMES = Number(process.env.KARABUDDY_STATS_MIN_GAMES) || 20;

const CARD_EVENTS = ['drawn', 'resourced', 'played', 'discarded'];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get('type') || 'leaders';
  const scopeKind = url.searchParams.get('scope') || 'global';
  const format = url.searchParams.get('format') || null;

  // Resolve + authorize the scope.
  let scope: StatsScope;
  let minGames = 1;
  if (scopeKind === 'personal') {
    const userId = await resolveUserIdFromRequest(req);
    if (!userId) return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });
    scope = { kind: 'personal', userId };
  } else if (scopeKind === 'team') {
    const teamSlug = url.searchParams.get('team');
    if (!teamSlug) return NextResponse.json({ ok: false, error: 'team slug required' }, { status: 400 });
    const userId = await resolveUserIdFromRequest(req);
    if (!userId) return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });
    const [member] = await getDb()
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamSlug, teamSlug)))
      .limit(1);
    if (!member) return NextResponse.json({ ok: false, error: 'not a team member' }, { status: 403 });
    scope = { kind: 'team', teamSlug };
  } else if (scopeKind === 'global') {
    scope = { kind: 'global' };
    minGames = GLOBAL_MIN_GAMES;
  } else {
    return NextResponse.json({ ok: false, error: 'bad scope' }, { status: 400 });
  }

  const opts = { scope, format, minGames };
  let data;
  if (type === 'matchups') {
    // byBase = the deck-vs-deck "Leaders & Bases" matrix; default is leader-only.
    data = url.searchParams.get('byBase') === '1' ? await getDeckMatchups(opts) : await getLeaderMatchups(opts);
  } else if (type === 'decks') {
    // Decks (leader + base-identity) played in scope — populates the deck picker.
    data = await getDecks({ ...opts, leader: url.searchParams.get('leader') || null });
  } else if (type === 'resourcing') {
    // First-person coaching stat — never global (no aggregate-meta meaning + it
    // would expose individual play quality). personal/team scopes only.
    if (scopeKind === 'global') return NextResponse.json({ ok: false, error: 'resourcing is personal/team only' }, { status: 400 });
    data = await getResourcingGames(opts);
  } else if (type === 'cards') {
    const event = (url.searchParams.get('event') || 'played') as CardEventKind;
    if (!CARD_EVENTS.includes(event)) return NextResponse.json({ ok: false, error: 'bad event' }, { status: 400 });
    // Deck context: card stats for games where the player was on this leader and
    // (optionally) this exact base — an ability base (`base`=cardId) or a vanilla
    // aspect (`baseAspect`). This is the team/personal "in MY deck" use case.
    const leader = url.searchParams.get('leader') || null;
    const baseId = url.searchParams.get('base') || null;
    const baseAspect = url.searchParams.get('baseAspect') || null;
    data = await getCardStats({ ...opts, event, leader, baseId, baseAspect });
  } else if (type === 'leaders') {
    data = await getLeaderStats(opts);
  } else {
    return NextResponse.json({ ok: false, error: 'bad type' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, scope: scopeKind, type, format, minGames, data });
}
