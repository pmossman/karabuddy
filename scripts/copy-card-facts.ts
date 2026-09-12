// B235 / shadow environment: populate match_players.card_events on a TARGET
// database from a SOURCE database that still has the legacy card_events table
// (i.e. prod before migration 0046 is deployed). Aggregates on the source
// (read-only, one query) and writes only the per-side maps — so the 6.6M-row
// table itself never has to be copied. Same aggregation as migration 0046.
//
//   SOURCE_URL="<neon>" TARGET_URL="<cockroach shadow>" npx tsx scripts/copy-card-facts.ts [--batch=500]

import pg from 'pg';

const SOURCE_URL = process.env.SOURCE_URL;
const TARGET_URL = process.env.TARGET_URL;
if (!SOURCE_URL || !TARGET_URL) { console.error('SOURCE_URL and TARGET_URL are required'); process.exit(1); }
const batchArg = process.argv.find((a) => a.startsWith('--batch='));
const BATCH = batchArg ? Number(batchArg.split('=')[1]) : 500;

function client(url: string) {
  // Let the URL's sslmode decide (verify-full for Neon's public CA, no-verify
  // or sslrootcert for a provider with a private CA such as Aiven).
  return new pg.Client({ connectionString: url });
}

async function main() {
  const src = client(SOURCE_URL!); const dst = client(TARGET_URL!);
  await src.connect(); await dst.connect();
  const started = Date.now();
  console.log('aggregating on source…');
  await src.query('BEGIN');
  await src.query(`DECLARE facts CURSOR FOR
    SELECT game_id, player_id, jsonb_object_agg(event, m) AS j
    FROM (
      SELECT game_id, player_id, event, jsonb_object_agg(card_id, first_frame) AS m
      FROM (SELECT game_id, player_id, event, card_id, min(frame_index) AS first_frame FROM card_events GROUP BY 1, 2, 3, 4) per_card
      GROUP BY 1, 2, 3
    ) per_event
    GROUP BY 1, 2`);
  let done = 0, matched = 0;
  for (;;) {
    const { rows } = await src.query(`FETCH ${BATCH} FROM facts`);
    if (rows.length === 0) break;
    const params: unknown[] = [];
    const tuples = rows.map((r) => { params.push(r.game_id, r.player_id, JSON.stringify(r.j)); const n = params.length; return `($${n - 2}::text, $${n - 1}::text, $${n}::jsonb)`; });
    const res = await dst.query(
      `UPDATE match_players AS mp SET card_events = v.j FROM (VALUES ${tuples.join(', ')}) AS v(game_id, player_id, j) WHERE mp.game_id = v.game_id AND mp.player_id = v.player_id`,
      params,
    );
    done += rows.length; matched += res.rowCount ?? 0;
    if (done % (BATCH * 20) === 0) console.log(`  ${done} sides (${matched} matched) · ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
  await src.query('CLOSE facts'); await src.query('COMMIT');
  const [{ n }] = (await dst.query(`select count(*) n from match_players where card_events is not null`)).rows;
  console.log(`done: ${done} sides aggregated, ${matched} target rows updated, ${n} target rows now carry card_events · ${((Date.now() - started) / 1000).toFixed(0)}s`);
  await src.end(); await dst.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
