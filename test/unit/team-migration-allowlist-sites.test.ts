import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ⏳ Guard for the limited-trial allowlist's THREE entrances.
//
// The gate is only worth anything if every way in honours it. The route and the
// preview screen have behavioural tests (test/api/forge-migration.test.ts,
// test/api/forge-migration-page.test.ts); the settings card is a fragment of a
// server page that pulls in half the app, so it is guarded here instead — which
// also states the invariant in one place: delete the check from ONE site and
// this fails, rather than quietly leaving a door open.
//
// Mirrors the source-scanning guards in canonical-components.test.ts /
// no-native-form-controls.test.ts, and runs in test:unit (part of the deploy
// gate).
//
// 🔓 When the trial ends and the move opens to every owner, all three of these
// go at once and this file goes with them.

const ROOT = join(__dirname, '..', '..');

const ENTRANCES: { label: string; file: string }[] = [
  {
    label: 'the settings card (the cosmetic one — hiding it hides nothing on its own)',
    file: 'app/(app)/teams/[slug]/page.tsx',
  },
  { label: 'the /teams/<slug>/move preview screen', file: 'app/(app)/teams/[slug]/move/page.tsx' },
  { label: 'POST /api/teams/<slug>/forge-migration', file: 'app/api/teams/[slug]/forge-migration/route.ts' },
];

describe('every entrance to the team move is behind the trial allowlist', () => {
  for (const { label, file } of ENTRANCES) {
    it(`${label} asks isTeamMigrationAllowedUser`, () => {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src).toContain('isTeamMigrationAllowedUser');
      // Stacks with the existing flag rather than replacing it: the shared
      // secret still has to be set, and being on the list is not a way past it.
      expect(src).toContain('forgeMigrationEnabled');
    });
  }
});
