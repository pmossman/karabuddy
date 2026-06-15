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

import { and, eq, inArray, count } from 'drizzle-orm';
import { getDb } from './db';
import { accounts, users, cards, tournamentEntrants, tournamentMatches, tournamentRounds, tournaments } from './schema';
import { postToChannel } from './discord';
import { teamChannelFor } from './teamDiscordChannel';
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

// B144: a tournament was created.
export function formatTournamentCreatedMessage(opts: {
  tournamentName: string;
  createdBy: string | null;
  url: string;
}): string {
  const by = opts.createdBy ? ` by **${opts.createdBy}**` : '';
  return `🆕 New tournament **${opts.tournamentName}** created${by} — register: ${opts.url}`;
}

// B144/B151: an entrant registered (or, with `updated`, changed their deck).
// Includes the decklist name + leader/base names when a deck is on file.
export function formatRegistrationMessage(opts: {
  tournamentName: string;
  entrantName: string;
  entrantCount: number;
  url: string;
  deckName?: string | null;
  leaderName?: string | null;
  baseName?: string | null;
  updated?: boolean; // a deck change rather than a fresh registration
}): string {
  const ident = [opts.leaderName, opts.baseName].filter(Boolean).join(' / ');
  // " with **DeckName** (Leader / Base)", any piece omitted if absent.
  const deckPart = opts.deckName
    ? ` **${opts.deckName}**${ident ? ` (${ident})` : ''}`
    : ident ? ` ${ident}` : '';
  if (opts.updated) {
    return `🔄 **${opts.entrantName}** updated their deck for **${opts.tournamentName}**`
      + (deckPart ? ` to${deckPart}` : '') + ` — ${opts.url}`;
  }
  return `🎟️ **${opts.entrantName}** registered for **${opts.tournamentName}**`
    + (deckPart ? ` with${deckPart}` : '')
    + ` (${opts.entrantCount} entrant${opts.entrantCount === 1 ? '' : 's'}) — ${opts.url}`;
}

// Resolve card ids (leader/base) → display names from the seeded `cards` catalog.
async function cardNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (want.length === 0) return new Map();
  const rows = await getDb().select({ cardId: cards.cardId, name: cards.name }).from(cards).where(inArray(cards.cardId, want));
  return new Map(rows.map((r) => [r.cardId, r.name ?? r.cardId]));
}

// B144: a match result was reported. Draw when game wins tie; "awaiting
// organizer" when the report is a player's (pending confirmation).
export function formatMatchResultMessage(opts: {
  tournamentName: string;
  roundNumber: number;
  table: number;
  entrant1: string;
  entrant2: string;
  e1Wins: number;
  e2Wins: number;
  pending: boolean;
  url: string;
}): string {
  let body: string;
  if (opts.e1Wins === opts.e2Wins) {
    body = `**${opts.entrant1}** ${opts.e1Wins}–${opts.e2Wins} **${opts.entrant2}** (draw)`;
  } else {
    const [w, l, ws, ls] = opts.e1Wins > opts.e2Wins
      ? [opts.entrant1, opts.entrant2, opts.e1Wins, opts.e2Wins]
      : [opts.entrant2, opts.entrant1, opts.e2Wins, opts.e1Wins];
    body = `**${w}** def. **${l}** ${ws}–${ls}`;
  }
  const tail = opts.pending ? ' _(reported — awaiting organizer)_' : '';
  return `⚔️ **${opts.tournamentName}** R${opts.roundNumber} · Table ${opts.table}: ${body}${tail}\nStandings: ${opts.url}`;
}

// ---------------------------------------------------------------------------
// Senders (best-effort; load everything from ids so route hooks stay one-liners)

// B144: tournament posts route to the team's tournament channel (override ??
// main). Was the bare discordChannelId before per-feature channels existed.
const teamChannel = (teamSlug: string) => teamChannelFor(teamSlug, 'tournament');

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

const tUrl = (teamSlug: string, tournamentId: string) =>
  `${publicUrl()}/teams/${teamSlug}/tournaments/${tournamentId}`;

async function userName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [u] = await getDb().select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.name ?? null;
}

// B144: a tournament was just created.
export async function notifyTournamentCreated(teamSlug: string, tournamentId: string, createdByUserId: string | null): Promise<void> {
  try {
    const channel = await teamChannel(teamSlug);
    if (!channel) return;
    const [t] = await getDb().select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
    if (!t) return;
    await postToChannel(channel, formatTournamentCreatedMessage({
      tournamentName: t.name,
      createdBy: await userName(createdByUserId),
      url: tUrl(teamSlug, tournamentId),
    }));
  } catch (err) {
    console.error('[karabuddy] tournament created notify failed:', err);
  }
}

// B144: an entrant just registered (member, guest-add, or public invite).
export async function notifyEntrantRegistered(
  teamSlug: string,
  tournamentId: string,
  opts: { entrantName: string; deckName?: string | null; leaderId?: string | null; baseId?: string | null; updated?: boolean },
): Promise<void> {
  try {
    const channel = await teamChannel(teamSlug);
    if (!channel) return;
    const db = getDb();
    const [t] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
    if (!t) return;
    const names = await cardNames([opts.leaderId, opts.baseId]);
    // The entrant count is part of the "registered" line only.
    let entrantCount = 0;
    if (!opts.updated) {
      const [{ n } = { n: 0 }] = await db
        .select({ n: count() })
        .from(tournamentEntrants)
        .where(eq(tournamentEntrants.tournamentId, tournamentId));
      entrantCount = Number(n);
    }
    await postToChannel(channel, formatRegistrationMessage({
      tournamentName: t.name,
      entrantName: opts.entrantName,
      entrantCount,
      url: tUrl(teamSlug, tournamentId),
      deckName: opts.deckName ?? null,
      leaderName: opts.leaderId ? names.get(opts.leaderId) ?? null : null,
      baseName: opts.baseId ? names.get(opts.baseId) ?? null : null,
      updated: opts.updated,
    }));
  } catch (err) {
    console.error('[karabuddy] tournament registration notify failed:', err);
  }
}

// B144: a match result was just reported/confirmed.
export async function notifyMatchReported(teamSlug: string, tournamentId: string, matchId: string): Promise<void> {
  try {
    const channel = await teamChannel(teamSlug);
    if (!channel) return;
    const db = getDb();
    const [m] = await db.select().from(tournamentMatches).where(eq(tournamentMatches.id, matchId)).limit(1);
    if (!m || !m.entrant2Id) return; // byes aren't reported
    const [[t], [round], entrants] = await Promise.all([
      db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1),
      db.select().from(tournamentRounds).where(eq(tournamentRounds.id, m.roundId)).limit(1),
      db.select().from(tournamentEntrants).where(inArray(tournamentEntrants.id, [m.entrant1Id, m.entrant2Id])),
    ]);
    if (!t || !round) return;
    const nameOf = new Map(entrants.map((e) => [e.id, e.displayName]));
    const games = (m.games as { winner: string | null }[] | null) ?? [];
    const e1Wins = games.filter((g) => g?.winner === m.entrant1Id).length;
    const e2Wins = games.filter((g) => g?.winner === m.entrant2Id).length;
    await postToChannel(channel, formatMatchResultMessage({
      tournamentName: t.name,
      roundNumber: round.number,
      table: m.tableNumber,
      entrant1: nameOf.get(m.entrant1Id) ?? '?',
      entrant2: nameOf.get(m.entrant2Id) ?? '?',
      e1Wins,
      e2Wins,
      pending: m.status === 'reported',
      url: tUrl(teamSlug, tournamentId),
    }));
  } catch (err) {
    console.error('[karabuddy] tournament match notify failed:', err);
  }
}
