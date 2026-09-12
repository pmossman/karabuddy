// B236 (DB size): decklists stored once, referenced per replay side.
//
// Before: every replay row embedded a full deck snapshot per side in
// `replays.decks` (~1 KB/row on disk, 136 MB in prod) — 142,724 snapshots that
// collapse to 24,743 distinct lists. Now (the swuforge pattern):
//
//   decklists            one row per distinct (leader, base, main, sideboard),
//                        keyed by an md5 of the normalized list
//   replays.deck_refs    { [playerId]: { username, name, leader, base, decklist } }
//                        — the small per-side envelope + a pointer
//
// Readers keep the `DecksByUserId` shape they always had: `hydrateDecks*`
// rebuilds `{ deck, sideboard }` from the referenced rows and re-attaches card
// costs from the catalog. (`internalName` — karabast's per-lobby card instance
// id — is not kept; the one consumer falls back to the card id.) Rows written
// before the migration keep `decks` until the contract migration; the hydrators
// fall back to it.
//
// The hash is computed identically in SQL (migration 0048 + `DECK_REFS_BACKFILL_SQL`)
// and here; `decklistHash.test.ts` pins the parity.

import { createHash } from 'node:crypto';
import { inArray, sql } from 'drizzle-orm';
import { getDb } from './db';
import { cards, decklists, replays } from './schema';
import type { DeckCardRef, DecksByUserId, UserDeck } from './replayDecoder';

export type CompactCard = [id: string, count: number];

export interface DeckRef {
  username: string | null;
  name?: string | null;
  leader: DeckCardRef | null;
  base: DeckCardRef | null;
  // null when this side's list was masked (the opponent) or never captured.
  decklist: string | null;
}
export type DeckRefsByUserId = Record<string, DeckRef>;

export interface NormalizedDecklist {
  id: string;
  leaderId: string | null;
  baseId: string | null;
  cards: CompactCard[];
  sideboard: CompactCard[];
  cardCount: number;
}

// Code-point order, matching `COLLATE "C"` in the SQL twin.
function compact(list: DeckCardRef[] | null | undefined): CompactCard[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && typeof c.id === 'string')
    .map((c): CompactCard => [c.id, Number(c.count) || 0])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const joined = (list: CompactCard[]) => list.map(([id, n]) => `${id}:${n}`).join(',');

export function normalizeDecklist(d: { leader?: DeckCardRef | null; base?: DeckCardRef | null; deck?: DeckCardRef[] | null; sideboard?: DeckCardRef[] | null }): NormalizedDecklist | null {
  if (!Array.isArray(d.deck)) return null;
  const cardsList = compact(d.deck);
  const side = compact(d.sideboard);
  const leaderId = d.leader?.id ?? null;
  const baseId = d.base?.id ?? null;
  const key = `${leaderId ?? ''}|${baseId ?? ''}|${joined(cardsList)}|${joined(side)}`;
  return {
    id: createHash('md5').update(key).digest('hex'),
    leaderId,
    baseId,
    cards: cardsList,
    sideboard: side,
    cardCount: cardsList.reduce((n, [, c]) => n + c, 0),
  };
}

// Split a payload's `decks` into decklist rows (to upsert) + the per-replay refs.
export function splitDecks(decks: DecksByUserId | null | undefined): { lists: NormalizedDecklist[]; refs: DeckRefsByUserId | null } {
  if (!decks || typeof decks !== 'object') return { lists: [], refs: null };
  const lists = new Map<string, NormalizedDecklist>();
  const refs: DeckRefsByUserId = {};
  for (const [pid, d] of Object.entries(decks)) {
    if (!d || typeof d !== 'object') continue;
    const norm = normalizeDecklist(d);
    if (norm) lists.set(norm.id, norm);
    refs[pid] = { username: d.username ?? null, name: d.name ?? null, leader: d.leader ?? null, base: d.base ?? null, decklist: norm?.id ?? null };
  }
  return { lists: [...lists.values()], refs: Object.keys(refs).length ? refs : null };
}

// Upsert the decklists a payload carries and return the refs to store on the
// replay row. Idempotent (content-addressed).
export async function storeDecks(decks: DecksByUserId | null | undefined): Promise<DeckRefsByUserId | null> {
  const { lists, refs } = splitDecks(decks);
  if (lists.length) {
    await getDb()
      .insert(decklists)
      .values(lists.map((l) => ({ id: l.id, leaderId: l.leaderId, baseId: l.baseId, cards: l.cards, sideboard: l.sideboard, cardCount: l.cardCount })))
      .onConflictDoNothing();
  }
  return refs;
}

type RowWithDecks = { deckRefs?: unknown; decks?: unknown };

// Rebuild `DecksByUserId` for many rows with two queries total (decklists by id,
// card costs by id). Legacy rows (no refs, embedded `decks`) pass through.
export async function hydrateDecksForRows<T extends RowWithDecks>(rows: T[]): Promise<(DecksByUserId | null)[]> {
  const ids = new Set<string>();
  for (const r of rows) {
    const refs = r.deckRefs as DeckRefsByUserId | null | undefined;
    if (refs) for (const ref of Object.values(refs)) if (ref?.decklist) ids.add(ref.decklist);
  }
  const listById = new Map<string, { cards: CompactCard[]; sideboard: CompactCard[] }>();
  const cardIds = new Set<string>();
  if (ids.size) {
    const db = getDb();
    for (let i = 0; i < ids.size; i += 500) {
      const chunk = [...ids].slice(i, i + 500);
      const found = await db.select({ id: decklists.id, cards: decklists.cards, sideboard: decklists.sideboard }).from(decklists).where(inArray(decklists.id, chunk));
      for (const l of found) {
        const c = (l.cards as CompactCard[]) ?? [];
        const s = (l.sideboard as CompactCard[]) ?? [];
        listById.set(l.id, { cards: c, sideboard: s });
        for (const [id] of c) cardIds.add(id);
        for (const [id] of s) cardIds.add(id);
      }
    }
  }
  const costById = new Map<string, number | null>();
  if (cardIds.size) {
    const db = getDb();
    for (let i = 0; i < cardIds.size; i += 500) {
      const chunk = [...cardIds].slice(i, i + 500);
      for (const c of await db.select({ cardId: cards.cardId, cost: cards.cost }).from(cards).where(inArray(cards.cardId, chunk))) costById.set(c.cardId, c.cost ?? null);
    }
  }
  const expand = (list: CompactCard[]): DeckCardRef[] => list.map(([id, count]) => ({ id, count, cost: costById.get(id) ?? null }));
  return rows.map((r) => {
    const refs = r.deckRefs as DeckRefsByUserId | null | undefined;
    if (!refs) return (r.decks as DecksByUserId | null | undefined) ?? null;
    const out: DecksByUserId = {};
    for (const [pid, ref] of Object.entries(refs)) {
      const list = ref.decklist ? listById.get(ref.decklist) : null;
      const deck: UserDeck = {
        username: ref.username ?? null,
        name: ref.name ?? null,
        leader: ref.leader ?? null,
        base: ref.base ?? null,
        deck: list ? expand(list.cards) : null,
        sideboard: list ? expand(list.sideboard) : null,
      };
      out[pid] = deck;
    }
    return out;
  });
}

export async function hydrateDecks(row: RowWithDecks | null | undefined): Promise<DecksByUserId | null> {
  if (!row) return null;
  return (await hydrateDecksForRows([row]))[0];
}

// The SQL twin of normalizeDecklist/splitDecks, used by migration 0048 (expand)
// and by the contract migration to convert rows old code wrote in between.
// Kept here so a test can pin hash parity with the TypeScript.
export const DECKLISTS_INSERT_SQL = `
INSERT INTO "decklists" ("id", "leader_id", "base_id", "cards", "sideboard", "card_count")
SELECT DISTINCT ON (h) h, leader_id, base_id, cards, sideboard, card_count
FROM (
  SELECT
    md5(coalesce(v.value->'leader'->>'id', '') || '|' || coalesce(v.value->'base'->>'id', '') || '|' ||
        coalesce((SELECT string_agg((e->>'id') || ':' || (e->>'count')::int, ',' ORDER BY (e->>'id') COLLATE "C") FROM jsonb_array_elements(v.value->'deck') e WHERE e->>'id' IS NOT NULL), '') || '|' ||
        coalesce((SELECT string_agg((e->>'id') || ':' || (e->>'count')::int, ',' ORDER BY (e->>'id') COLLATE "C") FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.value->'sideboard') = 'array' THEN v.value->'sideboard' ELSE '[]'::jsonb END) e WHERE e->>'id' IS NOT NULL), '')) AS h,
    v.value->'leader'->>'id' AS leader_id,
    v.value->'base'->>'id' AS base_id,
    coalesce((SELECT jsonb_agg(jsonb_build_array(e->>'id', (e->>'count')::int) ORDER BY (e->>'id') COLLATE "C") FROM jsonb_array_elements(v.value->'deck') e WHERE e->>'id' IS NOT NULL), '[]'::jsonb) AS cards,
    coalesce((SELECT jsonb_agg(jsonb_build_array(e->>'id', (e->>'count')::int) ORDER BY (e->>'id') COLLATE "C") FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.value->'sideboard') = 'array' THEN v.value->'sideboard' ELSE '[]'::jsonb END) e WHERE e->>'id' IS NOT NULL), '[]'::jsonb) AS sideboard,
    coalesce((SELECT sum((e->>'count')::int) FROM jsonb_array_elements(v.value->'deck') e WHERE e->>'id' IS NOT NULL), 0)::int AS card_count
  FROM "replays" r, jsonb_each(r."decks") v
  WHERE r."decks" IS NOT NULL AND r."deck_refs" IS NULL AND jsonb_typeof(v.value->'deck') = 'array'
) s
ON CONFLICT ("id") DO NOTHING`;

export const DECK_REFS_BACKFILL_SQL = `
UPDATE "replays" r SET "deck_refs" = (
  SELECT jsonb_object_agg(v.key, jsonb_build_object(
    'username', v.value->'username', 'name', v.value->'name', 'leader', v.value->'leader', 'base', v.value->'base',
    'decklist', CASE WHEN jsonb_typeof(v.value->'deck') = 'array' THEN
      md5(coalesce(v.value->'leader'->>'id', '') || '|' || coalesce(v.value->'base'->>'id', '') || '|' ||
        coalesce((SELECT string_agg((e->>'id') || ':' || (e->>'count')::int, ',' ORDER BY (e->>'id') COLLATE "C") FROM jsonb_array_elements(v.value->'deck') e WHERE e->>'id' IS NOT NULL), '') || '|' ||
        coalesce((SELECT string_agg((e->>'id') || ':' || (e->>'count')::int, ',' ORDER BY (e->>'id') COLLATE "C") FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.value->'sideboard') = 'array' THEN v.value->'sideboard' ELSE '[]'::jsonb END) e WHERE e->>'id' IS NOT NULL), ''))
    ELSE NULL END))
  FROM jsonb_each(r."decks") v WHERE jsonb_typeof(v.value) = 'object')
WHERE r."decks" IS NOT NULL AND r."deck_refs" IS NULL`;

// Run both halves (used by tests and by the contract migration's re-run).
export async function backfillDeckRefs(): Promise<void> {
  const db = getDb();
  await db.execute(sql.raw(DECKLISTS_INSERT_SQL));
  await db.execute(sql.raw(DECK_REFS_BACKFILL_SQL));
}

// Convenience for readers that select the replays table directly.
export const deckColumns = { deckRefs: replays.deckRefs };
