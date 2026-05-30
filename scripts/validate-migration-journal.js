// Shared drizzle-journal validator (CommonJS so both the prod-build guard
// in maybe-migrate.js and the unit test can use it). Catches the footgun
// that silently skipped 0010_tag_team_scope: drizzle applies journal
// entries whose `when` is GREATER than the last-applied timestamp, so a
// non-monotonic `when` is treated as already-past and never runs.
//
// Returns an array of human-readable error strings (empty = valid).

const fs = require('node:fs');
const path = require('node:path');

function validateMigrationJournal(root) {
  const errors = [];
  const journalPath = path.join(root, 'drizzle/meta/_journal.json');
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(journalPath, 'utf8')).entries || [];
  } catch (e) {
    return [`could not read ${journalPath}: ${e.message}`];
  }
  if (entries.length === 0) errors.push('journal has no entries');

  entries.forEach((e, i) => {
    if (e.idx !== i) errors.push(`entry ${i} has idx ${e.idx} (expected ${i}; idx must be contiguous from 0)`);
    if (i > 0 && !(e.when > entries[i - 1].when)) {
      errors.push(
        `${e.tag} (when=${e.when}) is not greater than previous ${entries[i - 1].tag} ` +
          `(when=${entries[i - 1].when}) — drizzle would SILENTLY SKIP it. Bump its \`when\` past the previous entry.`,
      );
    }
    const sql = path.join(root, 'drizzle', `${e.tag}.sql`);
    if (!fs.existsSync(sql)) errors.push(`missing migration file drizzle/${e.tag}.sql`);
  });

  return errors;
}

module.exports = { validateMigrationJournal };
