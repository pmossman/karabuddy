// Migration-safety guard (CommonJS so the unit test, CI, and the prod-build
// prebuild can all share it — same pattern as validate-migration-journal.js).
//
// THE HAZARD: prod migrations apply during the Vercel build's prebuild while
// the PREVIOUS deployment is still serving (migrate-then-promote). So any
// migration that the currently-running code can't tolerate causes a window of
// 500s. The safe rule is EXPAND/CONTRACT: migrations co-deployed with code must
// be backward-compatible (additive — add nullable/defaulted columns, add
// tables/indexes), and anything destructive (drop/rename/retype/SET NOT NULL)
// must ship as a SEPARATE, later "contract" deploy AFTER no running code
// references it.
//
// This guard fails the build/CI on destructive DDL unless the migration file
// carries an explicit `-- safe-migration: <reasoning>` annotation — forcing the
// author to confirm it's a deliberate contract-phase change (references already
// removed in a prior deploy), not an accidental same-deploy drop.

const fs = require('node:fs');
const path = require('node:path');

const RULES = [
  { re: /\bdrop\s+column\b/i, name: 'DROP COLUMN' },
  { re: /\bdrop\s+table\b/i, name: 'DROP TABLE' },
  { re: /\brename\s+column\b/i, name: 'RENAME COLUMN' },
  { re: /\brename\s+to\b/i, name: 'RENAME TO (table/column)' },
  { re: /\balter\s+column\b[\s\S]*?\btype\b/i, name: 'ALTER COLUMN ... TYPE' },
  { re: /\bset\s+not\s+null\b/i, name: 'SET NOT NULL on an existing column' },
];
// Acknowledgement: a `-- safe-migration: why this is OK` comment in the file.
const ACK_RE = /--\s*safe-migration\s*:/i;

function validateMigrationSafety(root) {
  const errors = [];
  const dir = path.join(root, 'drizzle');
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  } catch (e) {
    return [`could not read ${dir}: ${e.message}`];
  }
  for (const file of files.sort()) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const hits = RULES.filter((r) => r.re.test(sql)).map((r) => r.name);
    if (hits.length === 0) continue;
    if (ACK_RE.test(sql)) continue;
    errors.push(
      `${file}: non-additive DDL [${hits.join(', ')}] without a "-- safe-migration: ..." annotation. ` +
        `This can break the running deployment during the migrate-then-promote window. ` +
        `Prefer expand/contract: make it additive, or ship the drop as a SEPARATE deploy after the ` +
        `code referencing it is gone. If this IS a deliberate contract-phase migration, add a line ` +
        `like "-- safe-migration: contract — references removed in <prior deploy>" to acknowledge it.`,
    );
  }
  return errors;
}

module.exports = { validateMigrationSafety };
