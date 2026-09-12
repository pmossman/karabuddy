// B235 / free-tier migration: copy every public table from one Postgres to
// another (Neon → CockroachDB cutover). Read-only on the source; refuses to
// write into a target table that already has rows, so it can't clobber
// anything. Tables are copied in foreign-key dependency order with batched
// multi-row INSERTs, and row counts are verified at the end.
//
//   SOURCE_URL="<neon POSTGRES_URL_NON_POOLING>" TARGET_URL="<cockroach url>" \
//     npx tsx scripts/copy-db.ts [--only=table1,table2] [--batch=500] [--verify-only]
//
// The target must already have the schema (run `POSTGRES_URL_NON_POOLING=<target>
// npx drizzle-kit migrate` first). `drizzle.__drizzle_migrations` is copied too so
// the target's migration history matches.

import pg from 'pg';

const SOURCE_URL = process.env.SOURCE_URL;
const TARGET_URL = process.env.TARGET_URL;
if (!SOURCE_URL || !TARGET_URL) {
  console.error('SOURCE_URL and TARGET_URL are required');
  process.exit(1);
}

const args = process.argv.slice(2);
const num = (k: string, d: number) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
const only = (args.find((x) => x.startsWith('--only=')) || '').slice('--only='.length).split(',').filter(Boolean);
const verifyOnly = args.includes('--verify-only');
const BATCH = num('batch', 500);

function client(url: string) {
  const ssl = /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: !/sslmode=disable/.test(url) };
  return new pg.Client({ connectionString: url, ssl });
}

async function main() {
  const src = client(SOURCE_URL!);
  const dst = client(TARGET_URL!);
  await src.connect();
  await dst.connect();
  const srcHost = new URL(SOURCE_URL!).host;
  const dstHost = new URL(TARGET_URL!).host;
  console.log(`source=${srcHost} target=${dstHost}`);
  if (srcHost === dstHost) throw new Error('source and target are the same host');

  // Tables + FK graph from the SOURCE, topologically sorted so parents land first.
  const tables: string[] = (await src.query(
    `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name`,
  )).rows.map((r) => r.table_name);
  const fks: { child: string; parent: string }[] = (await src.query(`
    select tc.table_name as child, ccu.table_name as parent
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`)).rows;
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const f of fks) if (f.child !== f.parent) deps.get(f.child)?.add(f.parent);
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (t: string) => { if (seen.has(t)) return; seen.add(t); for (const p of deps.get(t) ?? []) visit(p); order.push(t); };
  tables.forEach(visit);

  const selected = only.length ? order.filter((t) => only.includes(t)) : order;
  console.log('order:', selected.join(' > '));

  const summary: { table: string; source: number; target: number; copied: number }[] = [];
  for (const t of selected) {
    const cols: { column_name: string; data_type: string }[] = (await src.query(
      `select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t],
    )).rows;
    const names = cols.map((c) => `"${c.column_name}"`).join(', ');
    const jsonCols = new Set(cols.filter((c) => c.data_type === 'jsonb' || c.data_type === 'json').map((c) => c.column_name));
    const sourceCount = Number((await src.query(`select count(*) n from "${t}"`)).rows[0].n);
    const targetCount = Number((await dst.query(`select count(*) n from "${t}"`)).rows[0].n);
    if (verifyOnly) { summary.push({ table: t, source: sourceCount, target: targetCount, copied: 0 }); continue; }
    if (targetCount > 0) {
      console.log(`${t}: target already has ${targetCount} rows (source ${sourceCount}) — skipping, will not overwrite`);
      summary.push({ table: t, source: sourceCount, target: targetCount, copied: 0 });
      continue;
    }
    console.log(`${t}: copying ${sourceCount} rows`);
    const started = Date.now();
    let copied = 0;
    await src.query('BEGIN');
    await src.query(`DECLARE copy_cur CURSOR FOR SELECT ${names} FROM "${t}"`);
    for (;;) {
      const { rows } = await src.query(`FETCH ${BATCH * 4} FROM copy_cur`);
      if (rows.length === 0) break;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const params: unknown[] = [];
        const tuples = chunk.map((r) => {
          const ph = cols.map((c) => {
            let v = r[c.column_name];
            if (jsonCols.has(c.column_name) && v !== null && v !== undefined) v = JSON.stringify(v);
            params.push(v);
            return `$${params.length}`;
          });
          return `(${ph.join(', ')})`;
        });
        await dst.query(`INSERT INTO "${t}" (${names}) VALUES ${tuples.join(', ')}`, params);
        copied += chunk.length;
      }
      if (copied % (BATCH * 40) === 0) console.log(`  ${t}: ${copied}/${sourceCount} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    }
    await src.query('CLOSE copy_cur');
    await src.query('COMMIT');
    console.log(`  ${t}: ${copied} rows in ${((Date.now() - started) / 1000).toFixed(0)}s`);
    summary.push({ table: t, source: sourceCount, target: copied, copied });
  }

  // Migration history, so drizzle-kit on the target sees the same applied set.
  if (!verifyOnly && !only.length) {
    const hist = (await src.query(`select hash, created_at from drizzle.__drizzle_migrations order by created_at`)).rows;
    const have = Number((await dst.query(`select count(*) n from drizzle.__drizzle_migrations`)).rows[0].n);
    if (have === 0) {
      for (const h of hist) await dst.query(`insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`, [h.hash, h.created_at]);
      console.log(`migration history: ${hist.length} rows`);
    } else console.log(`migration history: target already has ${have} rows, left alone`);
  }

  // Verify.
  let mismatches = 0;
  for (const s of summary) {
    const targetNow = Number((await dst.query(`select count(*) n from "${s.table}"`)).rows[0].n);
    const ok = targetNow === s.source;
    if (!ok) mismatches++;
    console.log(`${ok ? 'OK  ' : 'DIFF'} ${s.table}: source ${s.source} target ${targetNow}`);
  }
  await src.end();
  await dst.end();
  if (mismatches) { console.error(`${mismatches} table(s) differ`); process.exit(2); }
  console.log('all tables match');
}

main().catch((e) => { console.error(e); process.exit(1); });
