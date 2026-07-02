import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B136/B138: create a clip from the viewer's trim builder, then open its reel
// and confirm it plays to the end overlay with the watch-full link pointing
// back at the parent replay at the clip's start frame. B216: the builder opens
// from the panel's Clips view ("New clip from here" — the old clip-bubble FAB is
// gone), which is gated on tagging rights, so the viewer claims the upload.
test('create a clip → reel ends with summary; watch-full links back to the replay', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Clipper', email: 'clip-e2e@example.com' });
  const { slug, installToken } = await uploadReplay(request, {
    local: { username: 'ClipLocal', leaderName: 'Luke Skywalker' },
    opponent: { username: 'ClipOpp', leaderName: 'Darth Vader' },
    // Multiple distinct board positions so the viewer has >1 collapsed frame
    // (the clip builder is gated on that) and the clip has a real range.
    extraGamestatePatches: [
      { phase: 'action' },
      { newMessages: [['ClipLocal plays a card']] },
      { phase: 'regroup' },
      { newMessages: [['a later beat']] },
    ],
  });
  // Claim so the viewer isn't anonymized — "New clip from here" (canCreate)
  // is only offered to viewers with identity access.
  await claimInstallToken(page, installToken);

  await page.goto(`/r/${slug}`);

  // Open the trim builder from the panel's Clips view and create a clip.
  await page.getByRole('button', { name: 'Sidebar' }).click();
  await page.getByRole('button', { name: 'Clips', exact: true }).click();
  await page.getByRole('button', { name: /New clip from here/ }).click();
  await expect(page.getByTestId('clip-track')).toBeVisible();
  await page.getByTestId('clip-title').fill('e2e moment');
  await page.getByTestId('clip-create').click();

  const link = page.getByTestId('clip-link');
  await expect(link).toBeVisible();
  const clipUrl = await link.inputValue();
  expect(clipUrl).toContain('/c/cl_');

  // Open the reel.
  await page.goto(new URL(clipUrl).pathname);

  // The corner "watch full replay" deep-links back into the replay at the start.
  await expect(page.getByTestId('clip-watch-full')).toHaveAttribute('href', new RegExp(`/r/${slug}\\?f=`));

  // It auto-plays (no loop) and pauses on the end overlay with the rewatch + copy actions.
  await expect(page.getByTestId('clip-end-overlay')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('clip-replay')).toBeVisible();
  await expect(page.getByTestId('clip-copy-link')).toBeVisible();
});
