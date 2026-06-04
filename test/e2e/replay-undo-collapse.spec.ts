import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B102: the viewer collapses undone + board-static frames so stepping only
// lands on real, distinct board positions.
//
// Crafted timeline (6 recorded frames):
//   full(no phase) → B → B+log(static) → C → B(undo) → D
// collapses to 3:  full → B → D
//   - the log-only frame (board-static) is dropped
//   - C and the rewind landing are dropped (undo back to B)
test('viewer collapses undone + board-static frames', async ({ page }) => {
  await signInAsTestUser(page, { name: 'UndoViewer', email: 'undo@example.com' });
  const r = await uploadReplay(page.request, {
    local: { username: 'UndoViewer' },
    opponent: { username: 'Opp' },
    extraGamestatePatches: [
      { phase: 'B' },                    // board position B
      { newMessages: ['static log'] },   // board-static (still B) → dropped
      { phase: 'C' },                    // board position C
      { phase: 'B' },                    // undo back to B → C branch dropped
      { phase: 'D' },                    // board position D
    ],
  });
  await claimInstallToken(page, r.installToken);

  await page.goto(`/r/${r.slug}`);

  // 6 recorded frames collapse to 3 distinct board positions.
  const counter = page.getByTestId('frame-counter');
  await expect(counter).toHaveText('Frame 1 / 3');
});
