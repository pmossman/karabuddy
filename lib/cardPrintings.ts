// B226 fix: SWU cards are reprinted across sets + printed in variants (foils,
// hyperspace/showcase alt-arts, OP promos), so one logical card has MANY
// cardIds — e.g. "Lando Calrissian · Trust Me" is SEC_068 (the deck-legal base)
// plus SEC_332/578/…, SECOP_003, etc. The card finder must key on the card's
// IDENTITY (name + subtitle), not a single arbitrary printing: match every
// printing when finding plays, and show the base printing's art.

import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from './db';
import { cards } from './schema';

// A variant printing: a non-3-letter set (OP/promo like SECOP) or a lettered
// suffix (foil, e.g. SOR_197F). The deck-legal base is a 3-letter set + digits.
function isVariant(cardId: string): boolean {
  const m = cardId.match(/^([A-Za-z]+)_(\d+)([A-Za-z].*)?$/);
  if (!m) return true;
  return !!m[3] || m[1].length !== 3;
}

const cardNumber = (cardId: string): number => {
  const m = cardId.match(/_(\d+)/);
  return m ? parseInt(m[1], 10) : Infinity;
};

// The printing to DISPLAY: the lowest-numbered base printing (which is the
// standard art that actually exists), falling back to the lowest overall.
export function canonicalCardId(printings: string[]): string {
  const base = printings.filter((p) => !isVariant(p));
  const pool = base.length ? base : printings;
  return [...pool].sort((a, b) => cardNumber(a) - cardNumber(b))[0];
}

// Every cardId that is the same logical card (name + subtitle) as `cardId`.
// Falls back to `[cardId]` for unknown/nameless cards.
export async function cardPrintings(cardId: string): Promise<string[]> {
  const db = getDb();
  const [self] = await db
    .select({ name: cards.name, subtitle: cards.subtitle })
    .from(cards)
    .where(eq(cards.cardId, cardId));
  if (!self || self.name == null) return [cardId];
  const rows = await db
    .select({ cardId: cards.cardId })
    .from(cards)
    .where(and(
      eq(cards.name, self.name),
      self.subtitle == null ? isNull(cards.subtitle) : eq(cards.subtitle, self.subtitle),
    ));
  const ids = rows.map((r) => r.cardId);
  return ids.length ? ids : [cardId];
}
