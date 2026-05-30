import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// B73: the extension consumes a BYTE-FOR-BYTE copy of lib/commentScope.js
// at extension/replays/00-comment-scope.js (loaded as a classic content
// script before 05-footer.js). This guards the "one authoritative file"
// promise — if the source changes, regenerate the copy
// (`npm run sync:extension-shared`) or this fails.
describe('commentScope extension copy parity', () => {
  it('extension copy is identical to lib/commentScope.js', () => {
    const root = join(__dirname, '..');
    const source = readFileSync(join(root, 'lib/commentScope.js'), 'utf8');
    const copy = readFileSync(join(root, 'extension/replays/00-comment-scope.js'), 'utf8');
    expect(copy).toBe(source);
  });
});
