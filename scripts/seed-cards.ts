// B101/Phase 0 (ADR 0007): seed the `cards` catalog from swu-db (cost isn't in
// the replay payloads — see lib/cards). Idempotent + enriching: upserts every
// set, overwriting with the authoritative swu-db data (source='seed'). Cards
// only ever self-healed from gameplay (not yet on swu-db, e.g. fresh spoilers)
// keep their observed rows; a later re-run fills their cost.
//
// Run (confirm the target DB):
//   KARABUDDY_DB_DRIVER=pg POSTGRES_URL="<db>" npx tsx scripts/seed-cards.ts [setId ...]
// With no set args it seeds every set from swu-db's /sets index.

import { sql } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { cards } from '../lib/schema';
import { swuCardToRow } from '../lib/cards';

async function main() {
  const argSets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const sets: string[] = argSets.length
    ? argSets
    : ((await (await fetch('https://api.swu-db.com/sets')).json()) as any[]).map((s) => s.setId);
  const db = getDb();
  let total = 0;
  for (const set of sets) {
    let arr: any[] = [];
    try {
      const j: any = await (await fetch(`https://api.swu-db.com/cards/${String(set).toLowerCase()}`)).json();
      arr = j.data || j || [];
    } catch (e: any) {
      console.log(`  ${set}: fetch failed (${e?.message || e})`);
      continue;
    }
    if (!Array.isArray(arr) || !arr.length) { console.log(`  ${set}: 0`); continue; }
    // Dedupe by cardId within the set (variants share a Set+Number).
    const byId = new Map<string, ReturnType<typeof swuCardToRow>>();
    for (const c of arr) { const row = swuCardToRow(c); if (row.cardId) byId.set(row.cardId, row); }
    const rows = [...byId.values()];
    for (let i = 0; i < rows.length; i += 200) {
      await db
        .insert(cards)
        .values(rows.slice(i, i + 200))
        .onConflictDoUpdate({
          target: cards.cardId,
          set: {
            name: sql`excluded.name`, set: sql`excluded.set`, number: sql`excluded.number`,
            aspects: sql`excluded.aspects`, cost: sql`excluded.cost`, type: sql`excluded.type`,
            arena: sql`excluded.arena`, traits: sql`excluded.traits`, source: sql`'seed'`, updatedAt: sql`now()`,
          },
        });
    }
    total += rows.length;
    console.log(`  ${set}: ${rows.length}`);
  }
  console.log(`done — ${total} cards upserted across ${sets.length} sets`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
