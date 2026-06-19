import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// B170 / ADR 0010: the extension uses a BYTE-FOR-BYTE copy of lib/e2ee.js at
// extension/replays/00-e2ee.js so the crypto is provably identical on both
// sides (and the published-zip-vs-tag verification only has to audit one file).
// Regenerate with `npm run sync:extension-shared` if the source changes, or
// this fails. Same guard as commentScope / karabastShape.
describe('e2ee extension copy parity', () => {
  it('extension copy is identical to lib/e2ee.js', () => {
    const root = join(__dirname, '..');
    const source = readFileSync(join(root, 'lib/e2ee.js'), 'utf8');
    const copy = readFileSync(join(root, 'extension/replays/00-e2ee.js'), 'utf8');
    expect(copy).toBe(source);
  });
});
