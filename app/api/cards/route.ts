import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cards } from '@/lib/schema';
import { cachedRead, CACHE_TAGS } from '@/lib/cached';
import { canonicalCardId } from '@/lib/cardPrintings';

// B101/Phase1: card-catalog lookup for the viewer's resourcing analysis (which
// runs client-side on the already-decoded frames and only needs costs/names) and
// for cardId→name resolution across Stats + the replay grids.
//   GET /api/cards?ids=SOR_001,SHD_005,... → { ok, cards: { <id>: {name,...} } }
//
// Perf (Neon compute): this was re-querying the catalog on essentially every
// stats/replays render. The catalog is effectively STATIC reference data — names,
// costs, aspects never change; new cards only trickle in during spoiler season —
// so we cache the WHOLE catalog as one map and answer each request with an
// in-memory filter instead of a DB hit. One DB read per revalidate window
// (hourly) serves every caller; a brand-new card shows its id until the window
// rolls (acceptable). `cards` is self-healing on upload, so we never miss long.

type CardMeta = { name: string | null; subtitle: string | null; cost: number | null; type: string | null; aspects: string[] | null; arena: string | null };

const getCatalog = cachedRead(
  async (): Promise<Record<string, CardMeta>> => {
    const rows = await getDb()
      .select({ cardId: cards.cardId, name: cards.name, subtitle: cards.subtitle, cost: cards.cost, type: cards.type, aspects: cards.aspects, arena: cards.arena })
      .from(cards);
    const map: Record<string, CardMeta> = {};
    for (const r of rows) map[r.cardId] = { name: r.name, subtitle: r.subtitle, cost: r.cost, type: r.type, aspects: r.aspects, arena: r.arena };
    return map;
  },
  ['cards-catalog-v1'],
  { revalidate: 3600, tags: [CACHE_TAGS.cardsCatalog] },
);

export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get('ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 400);

  // B226: name search for the card-finder autocomplete. `?q=<name>` → a ranked
  // list of playable cards (units/events/upgrades — leaders/bases aren't "played"
  // as card events). Answered from the same cached catalog, no DB hit.
  const q = (new URL(req.url).searchParams.get('q') || '').trim().toLowerCase();
  if (q) {
    const catalog = await getCatalog();
    // Group every matching printing by the card's IDENTITY (name+subtitle), so
    // one logical card appears once — and its representative cardId is the
    // canonical (base-art) printing, not an arbitrary variant with no art.
    const groups = new Map<string, { ids: string[]; name: string; subtitle: string | null; type: string | null; aspects: string[] | null }>();
    for (const [cardId, m] of Object.entries(catalog)) {
      if (!m.name || m.type === 'leader' || m.type === 'base') continue;
      if (!m.name.toLowerCase().includes(q)) continue;
      const key = `${m.name}|${m.subtitle ?? ''}`;
      const g = groups.get(key);
      if (g) g.ids.push(cardId);
      else groups.set(key, { ids: [cardId], name: m.name, subtitle: m.subtitle, type: m.type, aspects: m.aspects });
    }
    const results = [...groups.values()]
      .sort((a, b) => {
        const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || a.name.localeCompare(b.name) || (a.subtitle ?? '').localeCompare(b.subtitle ?? '');
      })
      .slice(0, 20)
      .map((g) => ({ cardId: canonicalCardId(g.ids), name: g.name, subtitle: g.subtitle, type: g.type, aspects: g.aspects }));
    return NextResponse.json({ ok: true, results });
  }

  if (ids.length === 0) return NextResponse.json({ ok: true, cards: {} });
  const catalog = await getCatalog();
  const map: Record<string, CardMeta> = {};
  for (const id of ids) if (catalog[id]) map[id] = catalog[id];
  return NextResponse.json({ ok: true, cards: map });
}
