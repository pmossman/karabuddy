// B152: SWU deck legality. Validates a snapshotted tournament deck against the
// construction rules: a leader + base, a maindeck of at least 50, a sideboard of
// at most 10, and at most 3 copies of any card by TITLE — name + subtitle —
// across deck + sideboard (B167: two cards sharing a name but a different
// subtitle, e.g. Luke "Jedi Knight" vs "Answering the Call", are DISTINCT cards;
// reprints of the same card share both name + subtitle and still count together).
// Pure + title-resolver-injected (like resourcingAnalysis) so it's unit-testable;
// the copy check degrades gracefully when a card isn't in the catalog (it groups
// by id, never blocks on an unknown beyond a literal id collision).
import type { TournamentDeck, TournamentDeckCard } from './schema';

export const DECK_MIN = 50;
export const SIDEBOARD_MAX = 10;
export const COPY_MAX = 3;

export interface DeckViolation { code: 'no_deck' | 'no_leader' | 'no_base' | 'deck_size' | 'sideboard_size' | 'copy_limit'; message: string }

const total = (cards: TournamentDeckCard[] | null | undefined) =>
  (cards ?? []).reduce((s, c) => s + (Number(c.count) || 0), 0);

export function validateDeck(
  deck: TournamentDeck | null | undefined,
  opts?: { titleOf?: (id: string) => string | null },
): { legal: boolean; violations: DeckViolation[] } {
  if (!deck) return { legal: false, violations: [{ code: 'no_deck', message: 'No decklist submitted' }] };
  const violations: DeckViolation[] = [];

  if (!deck.leader) violations.push({ code: 'no_leader', message: 'No leader' });
  if (!deck.base) violations.push({ code: 'no_base', message: 'No base' });

  const deckCount = total(deck.deck);
  if (deckCount < DECK_MIN) violations.push({ code: 'deck_size', message: `Maindeck has ${deckCount} cards (min ${DECK_MIN})` });

  const sbCount = total(deck.sideboard);
  if (sbCount > SIDEBOARD_MAX) violations.push({ code: 'sideboard_size', message: `Sideboard has ${sbCount} cards (max ${SIDEBOARD_MAX})` });

  // At most 3 copies of a card by TITLE (name + subtitle) across maindeck +
  // sideboard. Different printings of the SAME card share a title and count
  // together; two cards that share only a name (different subtitle) are distinct
  // and counted separately.
  const byTitle = new Map<string, { title: string; count: number }>();
  for (const c of [...(deck.deck ?? []), ...(deck.sideboard ?? [])]) {
    const title = opts?.titleOf?.(c.id) || c.id;
    const key = title.toLowerCase();
    const e = byTitle.get(key) ?? { title, count: 0 };
    e.count += Number(c.count) || 0;
    byTitle.set(key, e);
  }
  const over = [...byTitle.values()].filter((e) => e.count > COPY_MAX);
  if (over.length) {
    violations.push({ code: 'copy_limit', message: `Over ${COPY_MAX} copies: ${over.map((e) => `${e.title} ×${e.count}`).join(', ')}` });
  }

  return { legal: violations.length === 0, violations };
}
