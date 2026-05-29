import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay } from './helpers';

// Settings page (karabast-username) + replay deletion + 404 paths.

test('settings: set karabast username → backfills matching anonymous replays', async ({ page, request }) => {
  // Upload anonymous replays where the local player username matches the
  // value we'll set — these must auto-claim when the user saves it.
  await uploadReplay(request, {
    local: { username: 'BackfillMe' },
    opponent: { username: 'X' },
  });
  await uploadReplay(request, {
    local: { username: 'BackfillMe' },
    opponent: { username: 'Y' },
  });

  await signInAsTestUser(page, { name: 'BackfillTester', email: 'bf@example.com' });

  await page.goto('/settings');
  await expect(page.getByPlaceholder(/ReprintConfiscate/i)).toBeVisible();
  await page.getByPlaceholder(/ReprintConfiscate/i).fill('BackfillMe');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Claimed 2 replay/)).toBeVisible({ timeout: 5000 });

  // Confirm the user now owns those replays via /replays?tab=mine.
  await page.goto('/replays?tab=mine');
  await expect(page.getByRole('link', { name: /BackfillMe vs X/ })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('link', { name: /BackfillMe vs Y/ })).toBeVisible();
});

test('owner can delete their replay (and viewer 404s after)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Deleter' });
  const { slug, installToken } = await uploadReplay(request, {
    local: { username: 'Deleter' },
    opponent: { username: 'V' },
  });

  // Viewer loads before delete.
  await page.goto(`/r/${slug}`);
  await expect(page.getByText(/Frame 1 \/ 1/)).toBeVisible();

  // Delete via API (mirrors the UI delete button, which hits the same endpoint).
  const del = await page.request.delete(`/api/replays/${slug}`, {
    headers: { 'X-Install-Token': installToken },
  });
  expect(del.ok()).toBe(true);

  // API metadata is gone.
  const getRes = await page.request.get(`/api/replays/${slug}`);
  expect(getRes.status()).toBe(404);
});

test('unknown replay slug returns 404 page (no crash)', async ({ page }) => {
  const res = await page.goto('/r/r_doesnotexist');
  expect(res?.status()).toBe(404);
});

test('non-owner cannot mutate someone else replay (403)', async ({ page, request }) => {
  // Anonymous upload — only the install token holder can mutate.
  const { slug } = await uploadReplay(request, {
    local: { username: 'Owner' },
    opponent: { username: 'Other' },
  });

  // Different signed-in user without the token → must be forbidden.
  await signInAsTestUser(page, { name: 'Interloper', email: 'inter@example.com' });
  const patchRes = await page.request.patch(`/api/replays/${slug}`, {
    data: { visibility: 'public' },
  });
  expect(patchRes.status()).toBe(403);
});
