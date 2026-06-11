// B124: shared load + authorization helpers for the tournament routes.
//
// Organizer = the tournament's creator OR any team owner. Every tournament
// route first gates on team membership (getTeamMembership), then uses these
// to load the tournament and decide organizer powers.

import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tournaments, tournamentEntrants, type Tournament, type TournamentEntrant, type TournamentDeck } from '@/lib/schema';

export async function loadTournament(teamSlug: string, id: string): Promise<Tournament | null> {
  const [row] = await getDb()
    .select()
    .from(tournaments)
    .where(and(eq(tournaments.id, id), eq(tournaments.teamSlug, teamSlug)))
    .limit(1);
  return row ?? null;
}

export function isOrganizer(t: Tournament, userId: string, role: string): boolean {
  return t.createdBy === userId || role === 'owner';
}

// Decklist visibility per tournament setting. `roundCount` answers "has the
// tournament started?" for hidden-until-start.
export function canSeeDeck(opts: {
  visibility: string;
  entrant: Pick<TournamentEntrant, 'userId'>;
  viewerUserId: string;
  viewerIsOrganizer: boolean;
  roundCount: number;
}): boolean {
  const { visibility, entrant, viewerUserId, viewerIsOrganizer, roundCount } = opts;
  if (viewerIsOrganizer) return true;
  if (entrant.userId && entrant.userId === viewerUserId) return true; // own list
  if (visibility === 'open') return true;
  if (visibility === 'hidden-until-start') return roundCount > 0;
  return false; // 'private'
}

// Serialize an entrant for the GET detail response, dropping the decklist
// when the viewer isn't allowed to see it (deckName/link stay hidden too —
// a deck name like "R2D2 ramp" leaks the archetype).
export function serializeEntrant(
  e: TournamentEntrant,
  visible: boolean
): Omit<TournamentEntrant, 'deck' | 'deckLink' | 'deckName'> & {
  deck: TournamentDeck | null;
  deckLink: string | null;
  deckName: string | null;
  hasDeck: boolean;
  deckVisible: boolean;
} {
  const { deck, deckLink, deckName, ...rest } = e;
  return {
    ...rest,
    deck: visible ? (deck as TournamentDeck | null) : null,
    deckLink: visible ? deckLink : null,
    deckName: visible ? deckName : null,
    hasDeck: !!deck,
    deckVisible: visible,
  };
}

export async function loadEntrant(tournamentId: string, entrantId: string): Promise<TournamentEntrant | null> {
  const [row] = await getDb()
    .select()
    .from(tournamentEntrants)
    .where(and(eq(tournamentEntrants.id, entrantId), eq(tournamentEntrants.tournamentId, tournamentId)))
    .limit(1);
  return row ?? null;
}
