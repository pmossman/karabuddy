// B125: Discord notifications for tournament round pairings + final standings,
// posted to the team's configured channel (B81 bot integration). Best-effort,
// never throws — awaited from the lifecycle routes with the same posture as
// notifyMentions (near-instant, a Discord failure can never fail the write).
// No-ops when the team has no channel configured or the bot token is unset.
//
// Linked entrants with a Discord-connected account get a real <@id> ping so
// "you're paired, go schedule" lands in their notifications; everyone else
// (guests, non-Discord sign-ins) renders as a bold name. Channel pings don't
// require the B99 DM opt-in — that gate is for DMs.

import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { accounts, teams, tournamentEntrants, tournamentMatches, tournamentRounds, tournaments } from './schema';
import { postToChannel } from './discord';
import { computeStandings } from './swiss';
import { toSwissMatches } from './tournamentLifecycle';

function publicUrl(): string {
  return (process.env.KARABUDDY_PUBLIC_URL || 'https://karabuddy.app').replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// Pure formatters (unit-tested)

export interface NotifyEntrant {
  name: string;
  discordId: string | null;
}
export interface NotifyPairing {
  table: number;
  entrant1: NotifyEntrant;
  entrant2: NotifyEntrant | null; // null = bye
}

const handle = (e: NotifyEntrant) => (e.discordId ? `<@${e.discordId}>` : `**${e.name}**`);

export function formatRoundMessage(opts: {
  tournamentName: string;
  roundNumber: number;
  pairings: NotifyPairing[];
  url: string;
}): string {
  const lines = [`🏆 **${opts.tournamentName}** — round ${opts.roundNumber} is paired:`];
  for (const p of opts.pairings) {
    if (p.entrant2 === null) {
      lines.push(`🎟️ ${handle(p.entrant1)} has the bye`);
    } else {
      lines.push(`⚔️ Table ${p.table}: ${handle(p.entrant1)} vs ${handle(p.entrant2)}`);
    }
  }
  lines.push(`Report results: ${opts.url}`);
  return lines.join('\n');
}

export function formatFinishedMessage(opts: {
  tournamentName: string;
  podium: { name: string; record: string }[]; // ordered, up to 3
  url: string;
}): string {
  const medals = ['🥇', '🥈', '🥉'];
  const lines = [`🏁 **${opts.tournamentName}** is finished!`];
  opts.podium.slice(0, 3).forEach((p, i) => lines.push(`${medals[i]} **${p.name}** (${p.record})`));
  lines.push(`Final standings: ${opts.url}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Senders (best-effort; load everything from ids so route hooks stay one-liners)

async function teamChannel(teamSlug: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ channel: teams.discordChannelId })
    .from(teams)
    .where(eq(teams.slug, teamSlug))
    .limit(1);
  return row?.channel ?? null;
}

async function discordIdsFor(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ userId: accounts.userId, discordId: accounts.providerAccountId })
    .from(accounts)
    .where(and(eq(accounts.provider, 'discord'), inArray(accounts.userId, userIds)));
  return new Map(rows.map((r) => [r.userId, r.discordId]));
}

export async function notifyRoundPaired(teamSlug: string, tournamentId: string, roundId: string): Promise<void> {
  try {
    const channel = await teamChannel(teamSlug);
    if (!channel) return;

    const db = getDb();
    const [t] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
    const [round] = await db.select().from(tournamentRounds).where(eq(tournamentRounds.id, roundId)).limit(1);
    if (!t || !round) return;
    const [matches, entrants] = await Promise.all([
      db.select().from(tournamentMatches).where(eq(tournamentMatches.roundId, roundId)),
      db.select().from(tournamentEntrants).where(eq(tournamentEntrants.tournamentId, tournamentId)),
    ]);

    const entrantById = new Map(entrants.map((e) => [e.id, e]));
    const discordIds = await discordIdsFor(entrants.map((e) => e.userId).filter((u): u is string => !!u));
    const toNotify = (entrantId: string): NotifyEntrant => {
      const e = entrantById.get(entrantId);
      return {
        name: e?.displayName ?? '?',
        discordId: e?.userId ? discordIds.get(e.userId) ?? null : null,
      };
    };

    const pairings: NotifyPairing[] = matches
      .sort((a, b) => a.tableNumber - b.tableNumber)
      .map((m) => ({
        table: m.tableNumber,
        entrant1: toNotify(m.entrant1Id),
        entrant2: m.entrant2Id ? toNotify(m.entrant2Id) : null,
      }));

    await postToChannel(channel, formatRoundMessage({
      tournamentName: t.name,
      roundNumber: round.number,
      pairings,
      url: `${publicUrl()}/teams/${teamSlug}/tournaments/${tournamentId}`,
    }));
  } catch (err) {
    console.error('[karabuddy] tournament round notify failed:', err);
  }
}

export async function notifyTournamentFinished(teamSlug: string, tournamentId: string): Promise<void> {
  try {
    const channel = await teamChannel(teamSlug);
    if (!channel) return;

    const db = getDb();
    const [t] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
    if (!t) return;
    const [matches, entrants] = await Promise.all([
      db.select().from(tournamentMatches).where(eq(tournamentMatches.tournamentId, tournamentId)),
      db.select().from(tournamentEntrants).where(eq(tournamentEntrants.tournamentId, tournamentId)),
    ]);

    const standings = computeStandings(
      entrants.map((e) => ({ id: e.id, dropped: e.dropped })),
      toSwissMatches(matches),
      tournamentId
    );
    const nameOf = new Map(entrants.map((e) => [e.id, e.displayName]));
    const podium = standings.slice(0, 3).map((s) => ({
      name: nameOf.get(s.entrantId) ?? '?',
      record: `${s.wins}–${s.losses}${s.draws > 0 ? `–${s.draws}` : ''}`,
    }));

    await postToChannel(channel, formatFinishedMessage({
      tournamentName: t.name,
      podium,
      url: `${publicUrl()}/teams/${teamSlug}/tournaments/${tournamentId}`,
    }));
  } catch (err) {
    console.error('[karabuddy] tournament finish notify failed:', err);
  }
}
