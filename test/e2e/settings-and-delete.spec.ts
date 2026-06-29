import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay } from './helpers';

// Settings page + replay deletion + 404 paths. (B84 removed the karabast-
// username feature — attribution is account-based now.)

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

test('settings: Linked extensions section lists claimed tokens + supports revoke', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'LinkUser', email: 'link@example.com' });
  // Claim a synthetic install token so the user has a row to see.
  const fakeToken = 'kbx_test_' + Math.random().toString(36).slice(2, 10);
  const claimRes = await page.request.post('/api/me/claim', { data: { token: fakeToken } });
  expect(claimRes.ok()).toBe(true);

  await page.goto('/settings?section=extension'); // B83: Linked extensions lives under the Extension section
  await expect(page.getByRole('heading', { name: /Linked extensions/i })).toBeVisible();

  const list = page.getByTestId('linked-extensions-list');
  await expect(list).toBeVisible();
  // Should contain a row that mentions the token's leading chars.
  const row = page.getByTestId('linked-extension-row').first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(fakeToken.slice(0, 12));

  // Revoke → confirm in the shared ConfirmDialog (B204, was a native confirm()).
  await row.getByRole('button', { name: /Revoke/i }).click();
  await page.getByTestId('confirm-dialog-confirm').click();
  // After revoke the row is gone.
  await expect(page.getByTestId('linked-extension-row')).toHaveCount(0);
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
    data: { displayName: 'Interloper rename attempt' },
  });
  expect(patchRes.status()).toBe(403);
});
