import { NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { cards } from '@/lib/schema';

// B101/Phase1: card-catalog lookup for the viewer's resourcing analysis (which
// runs client-side on the already-decoded frames and only needs costs/names).
// Public reference data — no auth. Capped at 400 ids/request.
//   GET /api/cards?ids=SOR_001,SHD_005,... → { ok, cards: { <id>: {name,cost,type,aspects,arena} } }
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get('ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 400);
  if (ids.length === 0) return NextResponse.json({ ok: true, cards: {} });
  const rows = await getDb()
    .select({ cardId: cards.cardId, name: cards.name, subtitle: cards.subtitle, cost: cards.cost, type: cards.type, aspects: cards.aspects, arena: cards.arena })
    .from(cards)
    .where(inArray(cards.cardId, ids));
  const map: Record<string, { name: string | null; subtitle: string | null; cost: number | null; type: string | null; aspects: string[] | null; arena: string | null }> = {};
  for (const r of rows) map[r.cardId] = { name: r.name, subtitle: r.subtitle, cost: r.cost, type: r.type, aspects: r.aspects, arena: r.arena };
  return NextResponse.json({ ok: true, cards: map });
}
