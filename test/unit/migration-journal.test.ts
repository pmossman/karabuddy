import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Same validator the prod-build guard (scripts/maybe-migrate.js) runs, so
// CI and deploy can't disagree about what a valid journal is.
import { validateMigrationJournal } from '../../scripts/validate-migration-journal';

// Guards the drizzle migration journal against the footgun that silently
// skipped 0010_tag_team_scope: the migrator applies journal entries whose
// `when` is GREATER than the last-applied migration's timestamp, so a
// non-monotonic `when` (e.g. a hand-authored migration with an earlier
// timestamp than its predecessor) is treated as already-past and never
// runs — `db:migrate` reports success while creating nothing, and prod's
// maybe-migrate skips it identically on deploy.
//
// Keep `when` strictly increasing with `idx`. Let `drizzle-kit generate`
// own the timestamp; if you hand-author a migration, set its `when` to be
// greater than the previous entry's.

const ROOT = join(__dirname, '..', '..');

interface JournalEntry { idx: number; when: number; tag: string }

function loadJournal(): JournalEntry[] {
  const raw = readFileSync(join(ROOT, 'drizzle/meta/_journal.json'), 'utf8');
  return JSON.parse(raw).entries as JournalEntry[];
}

describe('drizzle migration journal', () => {
  const entries = loadJournal();

  it('has at least one migration', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('idx values are contiguous from 0', () => {
    entries.forEach((e, i) => expect(e.idx).toBe(i));
  });

  it('`when` timestamps are STRICTLY increasing by idx (the skip-footgun guard)', () => {
    for (let i = 1; i < entries.length; i++) {
      expect(
        entries[i].when,
        `migration ${entries[i].tag} (when=${entries[i].when}) must be > previous ${entries[i - 1].tag} (when=${entries[i - 1].when}); ` +
          `a non-monotonic timestamp makes drizzle silently skip it`,
      ).toBeGreaterThan(entries[i - 1].when);
    }
  });

  it('every journal entry has a matching .sql file', () => {
    for (const e of entries) {
      expect(existsSync(join(ROOT, 'drizzle', `${e.tag}.sql`)), `missing drizzle/${e.tag}.sql`).toBe(true);
    }
  });

  it('passes the shared validator used by the prod-build guard', () => {
    expect(validateMigrationJournal(ROOT)).toEqual([]);
  });

  it('the validator CATCHES a non-monotonic `when` (proves the guard works)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-journal-'));
    mkdirSync(join(dir, 'drizzle', 'meta'), { recursive: true });
    // Second entry's `when` is EARLIER than the first — the exact bug.
    writeFileSync(join(dir, 'drizzle', 'meta', '_journal.json'), JSON.stringify({
      entries: [
        { idx: 0, when: 2000, tag: '0000_a' },
        { idx: 1, when: 1000, tag: '0001_b' },
      ],
    }));
    writeFileSync(join(dir, 'drizzle', '0000_a.sql'), '');
    writeFileSync(join(dir, 'drizzle', '0001_b.sql'), '');

    const errors = validateMigrationJournal(dir);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(/SKIP/i);
    rmSync(dir, { recursive: true, force: true });
  });
});
