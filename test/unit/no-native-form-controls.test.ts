import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Design-system guard (B90). Native checkbox/radio inputs bypass the KaraBuddy
// theme, so the chrome ends up with a mix of styled and unstyled controls.
// This test fails if any reappear in app/ — use the themed MUI primitives
// (<Checkbox> / <Radio> / <Switch> from @mui/material, styled via
// app/_theme/karabuddyTheme.ts) instead. The grep-guard approach mirrors the
// repo's other CI guards (validate-migration-*) and runs in `test:unit`, which
// is part of the deploy gate — so the "can't introduce an unstyled checkbox"
// guarantee is real without wiring full ESLint over the lifted gameboard code.
//
// Scope: checkbox + radio only for now (the explicit offenders). Selects and
// text inputs are a larger migration and are not yet guarded.

const ROOT = join(__dirname, '..', '..');
const APP_DIR = join(ROOT, 'app');
const NATIVE_CONTROL = /type=(["'])(checkbox|radio)\1/;

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

describe('design system: no native checkbox/radio in the chrome', () => {
  it('every checkbox/radio is a themed MUI primitive, not a native <input>', () => {
    const offenders: string[] = [];
    for (const file of walkTsx(APP_DIR)) {
      const src = readFileSync(file, 'utf8');
      if (NATIVE_CONTROL.test(src)) offenders.push(relative(ROOT, file));
    }
    expect(
      offenders,
      `Native checkbox/radio found — use MUI <Checkbox>/<Radio>/<Switch> (themed via ` +
        `app/_theme/karabuddyTheme.ts) instead:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
