import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Same validator the prod-build guard (scripts/maybe-migrate.js) runs, so CI
// and deploy can't disagree about what a "safe" migration is.
import { validateMigrationSafety } from '../../scripts/validate-migration-safety';

// Expand/contract guard (B85). Prod migrations apply during the Vercel build's
// prebuild while the PREVIOUS deployment is still serving (migrate-then-promote),
// so a migration the running code can't tolerate causes a window of 500s. The
// safe rule: co-deployed migrations are backward-compatible (additive), and
// destructive changes (drop/rename/retype/SET NOT NULL) ship as a SEPARATE
// contract deploy AFTER the referencing code is gone. The guard blocks
// non-additive DDL unless the file carries a `-- safe-migration: ...` ack.
//
// See docs/adr/0005-safe-deploys-expand-contract.md.

const ROOT = join(__dirname, '..', '..');

function tmpMigrations(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'kb-safety-'));
  mkdirSync(join(dir, 'drizzle'), { recursive: true });
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, 'drizzle', name), sql);
  }
  return dir;
}

describe('migration-safety guard', () => {
  it('the real drizzle/ migrations pass (additive, or acknowledged contract)', () => {
    expect(validateMigrationSafety(ROOT)).toEqual([]);
  });

  it('additive DDL is allowed without any annotation', () => {
    const dir = tmpMigrations({
      '0000_add.sql':
        'CREATE TABLE "t" ("id" text PRIMARY KEY);\n' +
        'ALTER TABLE "t" ADD COLUMN "n" integer DEFAULT 5 NOT NULL;\n' +
        'CREATE INDEX "t_n_idx" ON "t" ("n");',
    });
    expect(validateMigrationSafety(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('CATCHES an un-acknowledged DROP COLUMN (proves the guard works)', () => {
    const dir = tmpMigrations({ '0000_drop.sql': 'ALTER TABLE "t" DROP COLUMN "old";' });
    const errors = validateMigrationSafety(dir);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/DROP COLUMN/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('allows a DROP COLUMN once acknowledged as a contract-phase migration', () => {
    const dir = tmpMigrations({
      '0000_drop.sql':
        '-- safe-migration: contract — references removed in deploy N-1\nALTER TABLE "t" DROP COLUMN "old";',
    });
    expect(validateMigrationSafety(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('catches DROP TABLE, RENAME, ALTER TYPE, and SET NOT NULL', () => {
    const cases: Record<string, RegExp> = {
      '0000_a.sql': /DROP TABLE/,
      '0001_b.sql': /RENAME COLUMN/,
      '0002_c.sql': /ALTER COLUMN \.\.\. TYPE/,
      '0003_d.sql': /SET NOT NULL/,
    };
    const dir = tmpMigrations({
      '0000_a.sql': 'DROP TABLE "gone";',
      '0001_b.sql': 'ALTER TABLE "t" RENAME COLUMN "a" TO "b";',
      '0002_c.sql': 'ALTER TABLE "t" ALTER COLUMN "n" SET DATA TYPE bigint;',
      '0003_d.sql': 'ALTER TABLE "t" ALTER COLUMN "n" SET NOT NULL;',
    });
    const errors = validateMigrationSafety(dir);
    expect(errors.length).toBe(4);
    for (const [file, re] of Object.entries(cases)) {
      expect(errors.find((e) => e.startsWith(file))).toMatch(re);
    }
    rmSync(dir, { recursive: true, force: true });
  });
});
