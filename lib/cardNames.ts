// Resolve card ids → display names from the seeded `cards` catalog. Shared by
// the deck-legality copy check + the tournament Discord posts.
import { inArray } from 'drizzle-orm';
import { getDb } from './db';
import { cards } from './schema';

export async function cardNamesByIds(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (want.length === 0) return new Map();
  const rows = await getDb().select({ cardId: cards.cardId, name: cards.name }).from(cards).where(inArray(cards.cardId, want));
  return new Map(rows.map((r) => [r.cardId, r.name ?? r.cardId]));
}

// Resolve card ids → full TITLE (name + subtitle, e.g. "Luke Skywalker, Jedi
// Knight"). The deck 3-copy limit keys on this so two distinct cards sharing a
// name but differing by subtitle count separately, while reprints of the SAME
// card (shared name + subtitle, different set/number) still count together.
export async function cardTitlesByIds(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (want.length === 0) return new Map();
  const rows = await getDb().select({ cardId: cards.cardId, name: cards.name, subtitle: cards.subtitle }).from(cards).where(inArray(cards.cardId, want));
  return new Map(rows.map((r) => {
    const name = r.name ?? r.cardId;
    return [r.cardId, r.subtitle ? `${name}, ${r.subtitle}` : name];
  }));
}
