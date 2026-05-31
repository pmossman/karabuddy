import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, uploadReplay } from './helpers';

// B89: "Your replays" splits into All / Shared / Unlisted tabs so share status
// is never ambiguous. A replay with ≥1 team share is "Shared"; otherwise
// "Unlisted" (link-accessible, not surfaced to any team).
test('Shared / Unlisted tabs partition the library by team-share status', async ({ page }) => {
  await signInAsTestUser(page, { name: 'TabOwner', email: 'tabs@example.com' });
  const { slug: team } = await createTeam(page, 'Tab Team');

  // Owned by the signed-in user (uploaded via page.request → session cookie).
  const sharedReplay = await uploadReplay(page.request, {
    local: { username: 'TabOwner' },
    opponent: { username: 'SharedOpp' },
  });
  const unlistedReplay = await uploadReplay(page.request, {
    local: { username: 'TabOwner' },
    opponent: { username: 'UnlistedOpp' },
  });
  const shareRes = await page.request.post(`/api/replays/${sharedReplay.slug}/team-shares`, { data: { teamSlug: team } });
  expect(shareRes.ok(), `share failed: ${shareRes.status()}`).toBe(true);

  await page.goto('/replays');

  const sharedRow = page.getByText(/TabOwner vs SharedOpp|SharedOpp vs TabOwner/);
  const unlistedRow = page.getByText(/TabOwner vs UnlistedOpp|UnlistedOpp vs TabOwner/);

  // All tab (default): both present, and the counts reflect the split.
  await expect(page.getByTestId('replays-tab-all')).toContainText('2');
  await expect(page.getByTestId('replays-tab-shared')).toContainText('1');
  await expect(page.getByTestId('replays-tab-unlisted')).toContainText('1');
  await expect(sharedRow).toBeVisible();
  await expect(unlistedRow).toBeVisible();

  // Shared tab: only the team-shared replay.
  await page.getByTestId('replays-tab-shared').click();
  await expect(sharedRow).toBeVisible();
  await expect(unlistedRow).toHaveCount(0);

  // Unlisted tab: only the un-shared replay.
  await page.getByTestId('replays-tab-unlisted').click();
  await expect(unlistedRow).toBeVisible();
  await expect(sharedRow).toHaveCount(0);
});
