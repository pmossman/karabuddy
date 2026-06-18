// B152: server-side deck legality — resolves card names from the catalog (for the
// 3-copy-by-name check), then runs the pure validateDeck. One batch helper for the
// tournament page (validate every entrant's deck in a single catalog query) and a
// single helper for the submission routes.
import type { TournamentDeck } from './schema';
import { validateDeck, type DeckViolation } from './deckLegality';
import { cardTitlesByIds } from './cardNames';

export interface DeckLegality { legal: boolean; violations: DeckViolation[] }

const idsOf = (deck: TournamentDeck | null | undefined): string[] =>
  deck ? [...(deck.deck ?? []), ...(deck.sideboard ?? [])].map((c) => c.id) : [];

// Validate many decks with ONE catalog query (the tournament detail page).
export async function validateDecks(decks: (TournamentDeck | null | undefined)[]): Promise<DeckLegality[]> {
  const titles = await cardTitlesByIds(decks.flatMap(idsOf));
  const titleOf = (id: string) => titles.get(id) ?? null;
  return decks.map((d) => validateDeck(d, { titleOf }));
}

// Validate one deck (submission routes).
export async function validateDeckServer(deck: TournamentDeck | null | undefined): Promise<DeckLegality> {
  return (await validateDecks([deck]))[0];
}
