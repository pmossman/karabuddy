import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B123: the Replays Table view can't fit a phone — below 720px it degrades to
// the card layout so there's no horizontal scroll. The scope tab strip stays a
// single scrollable row (asserted by the hub tests; here we cover the swap).

test('mobile: the Table view renders cards instead of a wide table', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'MobileTable' });
  const { slug, installToken } = await uploadReplay(request, {
    local: { username: 'MobileTable', leaderName: 'Luke Skywalker' },
    opponent: { username: 'Opp', leaderName: 'Grand Admiral Thrawn' },
  });
  await claimInstallToken(page, installToken);

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/replays'); // Table is the default view

  // No wide table on mobile; the replay surfaces as a card linking to the viewer.
  await expect(page.locator('table')).toHaveCount(0);
  await expect(page.locator(`a[href="/r/${slug}"]`).first()).toBeVisible();
});

test('desktop: the Table view renders a table', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'DeskTable' });
  const { installToken } = await uploadReplay(request, {
    local: { username: 'DeskTable' },
    opponent: { username: 'Opp' },
  });
  await claimInstallToken(page, installToken);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/replays');

  await expect(page.locator('table')).toHaveCount(1);
});
