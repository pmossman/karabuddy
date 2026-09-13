// B236 / shadow environment: derive `decklists` + `replays.deck_refs` on a TARGET
// database from a SOURCE that still embeds `replays.decks` (prod before 0048).
// Streams the source's decks (read-only), normalizes/hashes in TypeScript (the
// same code the upload path uses), upserts decklists and sets refs on the target
// — so the 136 MB of embedded snapshots never has to be copied at all (pair with
// `copy-db --drop-cols=replays.decks`).
//
//   SOURCE_URL="<neon>" TARGET_URL="<shadow>" npx tsx scripts/copy-decklists.ts [--batch=500]

import pg from 'pg';
import { splitDecks, type NormalizedDecklist } from '../lib/decklists';

const SOURCE_URL = process.env.SOURCE_URL;
const TARGET_URL = process.env.TARGET_URL;
if (!SOURCE_URL || !TARGET_URL) { console.error('SOURCE_URL and TARGET_URL are required'); process.exit(1); }
const batchArg = process.argv.find((a) => a.startsWith('--batch='));
const BATCH = batchArg ? Number(batchArg.split('=')[1]) : 500;

async function main() {
  const src = new pg.Client({ connectionString: SOURCE_URL }); const dst = new pg.Client({ connectionString: TARGET_URL });
  await src.connect(); await dst.connect();
  const started = Date.now();
  await src.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await src.query(`DECLARE dk CURSOR FOR SELECT slug, decks FROM replays WHERE decks IS NOT NULL`);
  let rows = 0, lists = 0, refsSet = 0;
  const seen = new Set<string>();
  for (;;) {
    const { rows: page } = await src.query(`FETCH ${BATCH} FROM dk`);
    if (page.length === 0) break;
    const newLists: NormalizedDecklist[] = [];
    const refParams: unknown[] = []; const refTuples: string[] = [];
    for (const r of page) {
      const { lists: ls, refs } = splitDecks(r.decks);
      for (const l of ls) if (!seen.has(l.id)) { seen.add(l.id); newLists.push(l); }
      if (refs) { refParams.push(r.slug, JSON.stringify(refs)); const n = refParams.length; refTuples.push(`($${n - 1}::text, $${n}::jsonb)`); }
    }
    if (newLists.length) {
      const p: unknown[] = []; const t = newLists.map((l) => { p.push(l.id, l.leaderId, l.baseId, JSON.stringify(l.cards), JSON.stringify(l.sideboard), l.cardCount); const n = p.length; return `($${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}::jsonb, $${n - 1}::jsonb, $${n})`; });
      await dst.query(`INSERT INTO decklists (id, leader_id, base_id, cards, sideboard, card_count) VALUES ${t.join(', ')} ON CONFLICT (id) DO NOTHING`, p);
      lists += newLists.length;
    }
    if (refTuples.length) {
      const res = await dst.query(`UPDATE replays AS r SET deck_refs = v.refs FROM (VALUES ${refTuples.join(', ')}) AS v(slug, refs) WHERE r.slug = v.slug AND r.deck_refs IS NULL`, refParams);
      refsSet += res.rowCount ?? 0;
    }
    rows += page.length;
    if (rows % (BATCH * 20) === 0) console.log(`  ${rows} rows · ${lists} lists · ${refsSet} refs · ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
  await src.query('CLOSE dk'); await src.query('COMMIT');
  console.log(`done: ${rows} source rows → ${lists} decklists, ${refsSet} replays got refs · ${((Date.now() - started) / 1000).toFixed(0)}s`);
  await src.end(); await dst.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
