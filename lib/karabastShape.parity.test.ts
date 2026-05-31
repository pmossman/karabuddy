import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// B80: the extension uses a BYTE-FOR-BYTE copy of lib/karabastShape.js at
// extension/replays/00-karabast-shape.js so the drift rule + issue-code enum
// are identical on both sides. Regenerate with `npm run sync:extension-shared`
// if the source changes, or this fails.
describe('karabastShape extension copy parity', () => {
  it('extension copy is identical to lib/karabastShape.js', () => {
    const root = join(__dirname, '..');
    const source = readFileSync(join(root, 'lib/karabastShape.js'), 'utf8');
    const copy = readFileSync(join(root, 'extension/replays/00-karabast-shape.js'), 'utf8');
    expect(copy).toBe(source);
  });
});
