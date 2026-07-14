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
  kind: 'vanilla' | 'force' | 'splash' | 'shared' | 'unique' | 'unknown';
  aspect: string | null;
  // Art for pickers: unique bases get their card art; vanilla/force/splash/shared
  // groups are represented by the aspect icon instead (no single card IS the group).
  art: { set: string; number: number } | null;
  iconAspect: string | null;
  // Force/splash bases render the aspect icon + this overlay glyph
  // (/aspect-icons/{force,splash}.webp) — the community convention.
  overlay: 'force' | 'splash' | null;
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

  // Shared-group detection, scoped to (ASPECT, ability hash) — NOT the bare hash.
  // The same force-base ability text is borne by bases of MANY aspects, so a
  // whole-catalog group mixes aspects (and the identity key is per-aspect anyway).
  // Within one aspect a hash borne by >1 NAME is a force pair; the member names
  // label it. Reprints of one name don't make a pair.
  const groupKey = (aspect: string | null | undefined, hash: string) => `${aspect ?? '?'}::${hash}`;
  const hashes = Array.from(new Set(rows.map((r) => r.baseAbilityHash).filter((h): h is string => !!h)));
  const groupNames = new Map<string, Set<string>>();
  if (hashes.length) {
    const groupRows = await db
      .select({ hash: cards.baseAbilityHash, name: cards.name, aspects: cards.aspects })
      .from(cards)
      .where(and(eq(cards.type, 'base'), inArray(cards.baseAbilityHash, hashes)));
    for (const g of groupRows) {
      if (!g.hash || !g.name) continue;
      const k = groupKey((g.aspects as string[] | null)?.[0], g.hash);
      if (!groupNames.has(k)) groupNames.set(k, new Set());
      groupNames.get(k)!.add(g.name);
    }
  }

  for (const [id, ref] of wanted) {
    const row = byId.get(id);
    const aspect = row?.aspects?.[0] ?? null;
    const subtype = (row as any)?.baseSubtype as 'force' | 'splash' | null | undefined;
    if (row && row.hasAbility === false && aspect) {
      out.set(id, { key: `asp:${aspect}`, label: `${cap(aspect)} base`, kind: 'vanilla', aspect, art: null, iconAspect: aspect, overlay: null });
    } else if (row && row.hasAbility && row.baseAbilityHash && aspect && (subtype === 'force' || subtype === 'splash')) {
      // The two community-recognized SHARED base kinds. Distinguished by TYPE
      // (aspect icon + force/splash glyph), not by listing names — so the two
      // aggression force-pairs read as "Aggression · Force" vs "Aggression · Splash".
      out.set(id, {
        key: `ab:${aspect}:${row.baseAbilityHash}`,
        label: `${cap(aspect)} · ${cap(subtype)}`,
        kind: subtype, aspect, art: null, iconAspect: aspect, overlay: subtype,
      });
    } else if (row && row.hasAbility && row.baseAbilityHash && aspect) {
      const names = groupNames.get(groupKey(aspect, row.baseAbilityHash)) ?? new Set([row.name ?? '']);
      if (names.size > 1) {
        // Fallback: an unclassified shared ability (not force/splash). Label by
        // the member names so distinct groups don't collide. The KEY (ability
        // hash) groups the printings; this just names the group.
        const label = [...names].filter(Boolean).sort().join(' / ');
        out.set(id, { key: `ab:${aspect}:${row.baseAbilityHash}`, label, kind: 'shared', aspect, art: null, iconAspect: aspect, overlay: null });
      } else {
        out.set(id, {
          key: `ab:${aspect}:${row.baseAbilityHash}`,
          label: row.name ?? ref.name ?? id,
          kind: 'unique',
          aspect,
          art: { set: ref.set, number: ref.number },
          iconAspect: null,
          overlay: null,
        });
      }
    } else {
      // Catalog doesn't know this card (fresh spoiler / test data): fall back
      // to name identity so filtering still works, just ungrouped.
      const label = ref.name ?? id;
      out.set(id, { key: `name:${label}`, label, kind: 'unknown', aspect: null, art: { set: ref.set, number: ref.number }, iconAspect: null, overlay: null });
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
