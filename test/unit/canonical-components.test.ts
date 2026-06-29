import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Canonical-component guards (conceptual-dup audit follow-up). Once a shared
// primitive exists for a concept, the DIVERGENT hand-rolled path must fail CI so
// the unification can't silently re-fork — the exact failure mode behind the
// deck-viewer trio (three surfaces each rendering decks their own way). Mirrors
// the native-form-control guard (no-native-form-controls.test.ts); runs in
// test:unit, which is part of the deploy gate.
//
// Each guard's ALLOWLIST is the migration backlog for that concept: the bespoke
// copies that predate the primitive. Shrink each allowlist toward [] as they
// move onto the canonical component — and NEW offenders fail immediately.
//
// NOTE: only concepts with a greppable divergent signature can be guarded this
// way (raw <select>, native inputs, …). Concepts like "render a deck list" or
// "a segmented control" have no syntactic tell — those are guarded by the
// canonical-components registry in CONTEXT.md + the periodic concept audit.

const ROOT = join(__dirname, '..', '..');
const APP_DIR = join(ROOT, 'app');

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walkTsx(full));
    } else if (entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

interface Guard {
  concept: string;
  pattern: RegExp;
  canonical: string[]; // the shared primitive's own file(s) — allowed to contain the pattern
  allowlist: string[]; // grandfathered bespoke copies — the migration backlog
  fix: string;
}

const GUARDS: Guard[] = [
  {
    concept: 'dropdown',
    pattern: /<select[\s>]/,
    canonical: ['app/_components/Select.tsx'],
    // TODO(concept-dup tier 1): migrate these onto <Select>, then delete here.
    allowlist: [
      'app/(app)/teams/[slug]/TeamDiscordConnect.tsx',
      'app/(app)/teams/[slug]/PrivateModeToggle.tsx',
      'app/(app)/teams/[slug]/TransferOwnership.tsx',
      'app/(app)/teams/[slug]/TeamTournaments.tsx',
    ],
    fix: 'use the shared <Select> (app/_components/Select.tsx)',
  },
];

describe('canonical components: a divergent path fails CI once a primitive exists', () => {
  const files = walkTsx(APP_DIR);
  for (const g of GUARDS) {
    it(`${g.concept}: no new hand-rolled copies (use the shared primitive)`, () => {
      const allowed = new Set([...g.canonical, ...g.allowlist]);
      const offenders = files
        .map((f) => relative(ROOT, f))
        .filter((rel) => !allowed.has(rel))
        .filter((rel) => g.pattern.test(readFileSync(join(ROOT, rel), 'utf8')));
      expect(
        offenders,
        `Hand-rolled ${g.concept} found — ${g.fix}:\n  ${offenders.join('\n  ')}`,
      ).toEqual([]);
    });
  }
});
