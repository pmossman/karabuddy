// B101/Phase 0 (ADR 0007): card catalog mapping. Cost/name/aspects/type/arena
// aren't in the replay payloads (the gamestate omits cost entirely), so the
// catalog is seeded from swu-db. This is the pure swu-db→row mapper, kept
// separate from the seed script so it's unit-testable without the network/DB.
// cardId MUST match what lib/statsExtract produces from the gamestate
// (`${set}_${zero-padded number}`) so facts join the catalog.

export interface SwuCard {
  Set: string;
  Number: string | number;
  Name?: string;
  Cost?: string | number | null;
  Type?: string;
  Aspects?: string[];
  Arenas?: string[];
  Traits?: string[];
  FrontText?: string | null;
  Text?: string | null;
}

export interface CatalogRow {
  cardId: string;
  name: string | null;
  set: string | null;
  number: number | null;
  aspects: string[] | null;
  cost: number | null;
  type: string | null;
  arena: string | null;
  traits: string[] | null;
  hasAbility: boolean | null;
  source: string;
}

// `${SET}_${NNN}` — numeric numbers zero-pad to 3 (matching the gamestate-
// derived id); non-numeric (tokens etc.) pass through raw.
export function cardIdFromSetNumber(set: string, number: string | number): string {
  const n = Number(number);
  const num = Number.isFinite(n) ? String(n).padStart(3, '0') : String(number);
  return `${set}_${num}`;
}

export function swuCardToRow(c: SwuCard): CatalogRow {
  const costN = c.Cost == null || c.Cost === '' ? NaN : Number(c.Cost);
  const numInt = Number.parseInt(String(c.Number), 10);
  const type = c.Type ? c.Type.toLowerCase() : null;
  // A base "defines a deck" iff it has rules text (an Epic Action). Only
  // meaningful for bases; null elsewhere so we never imply a unit/event has no
  // ability. FrontText is the printed body on bases; fall back to Text.
  const ability = (c.FrontText ?? c.Text ?? '').trim();
  return {
    cardId: cardIdFromSetNumber(c.Set, c.Number),
    name: c.Name ?? null,
    set: c.Set ?? null,
    number: Number.isFinite(numInt) ? numInt : null,
    // Lowercase aspects to match the gamestate-derived aspects on match_players.
    aspects: Array.isArray(c.Aspects) ? c.Aspects.map((a) => a.toLowerCase()) : null,
    cost: Number.isFinite(costN) ? costN : null,
    type, // unit | event | upgrade | leader | base
    arena: Array.isArray(c.Arenas) && c.Arenas.length ? c.Arenas[0].toLowerCase() : null, // ground | space | null
    traits: Array.isArray(c.Traits) ? c.Traits : null,
    hasAbility: type === 'base' ? ability.length > 0 : null,
    source: 'seed',
  };
}
