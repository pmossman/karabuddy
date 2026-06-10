import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken, createTeam } from './helpers';

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

test('mobile: scope is a tap-to-open picker, not a hidden scroll strip', async ({ page }) => {
  await signInAsTestUser(page, { name: 'ScopeUser' });
  const { slug } = await createTeam(page, 'Squad Seven');

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/replays');

  // No inline team tab on mobile — the team lives behind a picker button.
  await expect(page.getByRole('tab', { name: 'Squad Seven' })).toHaveCount(0);
  const picker = page.getByRole('button', { name: 'Switch replay scope' });
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('My replays');

  // Tap → menu lists every scope; choosing the team navigates the hub.
  await picker.click();
  await page.getByRole('menuitem', { name: 'Squad Seven' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('team')).toBe(slug);
});
