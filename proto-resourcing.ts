// THROWAWAY harness: run the REAL lib/resourcingAnalysis (regret-v2) over a
// real prod replay, with costs/names from the seeded prod `cards` catalog.
//   PU=<prod url> node --import tsx proto-resourcing.ts [slug]
import { neon } from '@neondatabase/serverless';
import { decodeReplay } from './lib/replayDecoder';
import { analyzeResourcing } from './lib/resourcingAnalysis';

const SLUG = process.argv[2];
const cid = (c: any): string | null => {
  const s = c?.setId;
  return s && s.set && s.set !== 'REPLAYHIDDEN' && s.number != null ? `${s.set}_${String(s.number).padStart(3, '0')}` : null;
};

(async () => {
  const sql = neon(process.env.PU!, { fullResults: true });
  const row = (SLUG
    ? await sql.query('select slug, payload_blob_url from replays where slug=$1', [SLUG])
    : await sql.query('select slug, payload_blob_url from replays order by action_count desc nulls last limit 1')
  ).rows[0];
  const frames = decodeReplay(JSON.parse(await (await fetch(row.payload_blob_url)).text())).frames;

  const ids = new Set<string>();
  for (const f of frames) for (const pid of Object.keys(f.state.players || {})) for (const z of Object.keys(f.state.players[pid].cardPiles || {})) for (const c of f.state.players[pid].cardPiles[z] || []) { const id = cid(c); if (id) ids.add(id); }
  const cat = (await sql.query('select card_id, name, cost from cards where card_id = any($1)', [[...ids]])).rows;
  const COST: Record<string, number | null> = {}; const NAME: Record<string, string> = {};
  for (const c of cat) { COST[c.card_id] = c.cost; NAME[c.card_id] = c.name || c.card_id; }

  const r = analyzeResourcing(frames, { costOf: (id) => COST[id] ?? null, nameOf: (id) => NAME[id] || id });
  console.log(`\n=== ${row.slug} — ${r.username} — ${r.rounds.length} rounds ===`);
  for (const rd of r.rounds) {
    const tag = rd.float > 0 ? `floated ${rd.float}/${rd.resources} [${rd.reason}]${rd.isFinal ? ' (final, ignored)' : ''}` : `spent (${rd.resources})`;
    console.log(`R${rd.round}: ${tag}` + (rd.plays.length ? ` · played ${rd.plays.map((p) => NAME[p] || p).join(', ')}` : '') + (rd.resourced.length ? ` · resourced ${rd.resourced.map((p) => NAME[p] || p).join(', ')}` : ''));
  }
  console.log(`\nfloat: ${r.floatTotal} total — ${r.floatByReason.initiative} initiative, ${r.floatByReason.forced} forced, ${r.floatByReason.underspend} underspend`);
  console.log(`dead cards: ${r.deadCards.length} [${r.deadCards.map((d) => NAME[d.cardId] || d.cardId).slice(0, 10).join(', ')}]`);
  console.log(`\n--- regret flags (${r.flags.length}) ---`);
  for (const f of r.flags) console.log(`  [${f.kind}] ${f.message}`);
  if (!r.flags.length) console.log('  (none)');
})().catch((e) => console.log('ERR', e.message, e.stack));
