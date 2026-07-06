import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { cards } from './schema';
import { cardIdFromSetNumber } from './cards';

// Base FUNCTIONAL IDENTITY (B221 follow-up) — the single shared answer to
// "which bases are actually the same base?". Many SWU bases are functionally
// interchangeable, so name-level base filters offer meaningless choices:
//   • vanilla 30-HP bases (no ability) — interchangeable within an aspect
//   • the LOF "force pairs" — two differently-named bases per aspect with
//     byte-identical ability text
//   • reprints — the same card under many cardIds across sets
// Identity key:
//   asp:<aspect>        vanilla — any no-ability base of that aspect
//   ab:<aspect>:<hash>  ability bases, grouped by normalized-text fingerprint
//                       (cards.base_ability_hash): reprints and force pairs
//                       collapse, genuinely unique bases stay unique
//   name:<name>         fallback when the catalog doesn't know the card
// Consumers: the openings base filters; the stats deck axis is the same idea
// (vanilla→aspect) and adopting ab:-grouping there is tracked in BACKLOG.
// Render vanilla/shared groups with the aspect icon
// (/aspect-icons/aspect-<aspect>.webp), unique bases with their card art.

export interface BaseIdentity {
  key: string;
  label: string;
  kind: 'vanilla' | 'shared' | 'unique' | 'unknown';
  aspect: string | null;
  // Art for pickers: unique bases get their card art; vanilla/shared groups
  // are represented by the aspect icon instead (no single card IS the group).
  art: { set: string; number: number } | null;
  iconAspect: string | null;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Resolve identities for a set of base card refs ({set, number, name}).
// Returns a map keyed by `${set}_${number}` id. Batch: two catalog queries
// total, regardless of input size.
export async function resolveBaseIdentities(
  refs: Array<{ set?: string | null; number?: number | string | null; name?: string | null }>,
): Promise<Map<string, BaseIdentity>> {
  const db = getDb();
  const wanted = new Map<string, { set: string; number: number; name: string | null }>();
  for (const r of refs) {
    if (!r?.set || r.number == null) continue;
    const id = cardIdFromSetNumber(r.set, r.number);
    if (!wanted.has(id)) wanted.set(id, { set: r.set, number: Number(r.number), name: r.name ?? null });
  }
  const out = new Map<string, BaseIdentity>();
  if (wanted.size === 0) return out;

  const rows = wanted.size
    ? await db.select().from(cards).where(inArray(cards.cardId, Array.from(wanted.keys())))
    : [];
  const byId = new Map(rows.map((r) => [r.cardId, r]));

  // Shared-group detection: an ability hash borne by >1 distinct NAME in the
  // whole catalog is a functional group (the force pairs). Reprints of one
  // name don't make a group by themselves.
  const hashes = Array.from(new Set(rows.map((r) => r.baseAbilityHash).filter((h): h is string => !!h)));
  const groupNames = new Map<string, Set<string>>();
  if (hashes.length) {
    const groupRows = await db
      .select({ hash: cards.baseAbilityHash, name: cards.name })
      .from(cards)
      .where(and(eq(cards.type, 'base'), inArray(cards.baseAbilityHash, hashes)));
    for (const g of groupRows) {
      if (!g.hash || !g.name) continue;
      if (!groupNames.has(g.hash)) groupNames.set(g.hash, new Set());
      groupNames.get(g.hash)!.add(g.name);
    }
  }

  for (const [id, ref] of wanted) {
    const row = byId.get(id);
    const aspect = row?.aspects?.[0] ?? null;
    if (row && row.hasAbility === false && aspect) {
      out.set(id, { key: `asp:${aspect}`, label: `${cap(aspect)} base`, kind: 'vanilla', aspect, art: null, iconAspect: aspect });
    } else if (row && row.hasAbility && row.baseAbilityHash && aspect) {
      const names = groupNames.get(row.baseAbilityHash) ?? new Set([row.name ?? '']);
      if (names.size > 1) {
        // Today every multi-name group is a LOF force pair; label accordingly.
        // If a future set ships a non-force shared pair, revisit the label —
        // the KEY stays correct either way.
        out.set(id, { key: `ab:${aspect}:${row.baseAbilityHash}`, label: `${cap(aspect)} force base`, kind: 'shared', aspect, art: null, iconAspect: aspect });
      } else {
        out.set(id, {
          key: `ab:${aspect}:${row.baseAbilityHash}`,
          label: row.name ?? ref.name ?? id,
          kind: 'unique',
          aspect,
          art: { set: ref.set, number: ref.number },
          iconAspect: null,
        });
      }
    } else {
      // Catalog doesn't know this card (fresh spoiler / test data): fall back
      // to name identity so filtering still works, just ungrouped.
      const label = ref.name ?? id;
      out.set(id, { key: `name:${label}`, label, kind: 'unknown', aspect: null, art: { set: ref.set, number: ref.number }, iconAspect: null });
    }
  }
  return out;
}

// Post-pass for serialized replay rows: one batched resolve for every base in
// the list, then attach ownBaseKind/oppBaseKind in place. Call where a
// base-filterable surface assembles its rows.
export async function attachBaseKinds<T extends { ownBase?: any; oppBase?: any; ownBaseKind?: any; oppBaseKind?: any }>(
  rows: T[],
): Promise<T[]> {
  const refs = rows.flatMap((r) => [r.ownBase, r.oppBase]).filter(Boolean);
  const ids = await resolveBaseIdentities(refs);
  const kindOf = (base: any) => {
    if (!base?.set || base?.number == null) return null;
    const n = Number(base.number);
    const id = `${base.set}_${Number.isFinite(n) ? String(n).padStart(3, '0') : String(base.number)}`;
    return ids.get(id) ?? null;
  };
  for (const r of rows) {
    r.ownBaseKind = kindOf(r.ownBase);
    r.oppBaseKind = kindOf(r.oppBase);
  }
  return rows;
}
