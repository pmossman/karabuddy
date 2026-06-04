import { test, expect } from '@playwright/test';

// B101/Phase2: the /stats surface is public (global is the SEO/growth view),
// so it renders signed-out. Smoke: the shell, audience switcher, and view tabs.
test('stats page renders the meta surface (public)', async ({ page }) => {
  await page.goto('/stats');
  // The page does a couple of client fetches on mount; give the first paint room.
  await expect(page.getByRole('heading', { name: /Meta\s*Stats/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Global' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leaders' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Matchups' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cards' })).toBeVisible();
  // Cards view exposes the recorder-side vs whole-meta attribution label.
  await page.getByRole('button', { name: 'Cards' }).click();
  await expect(page.getByText(/whole-meta|recorder-side/i)).toBeVisible();
});

test('Stats appears in the header nav', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Stats' })).toBeVisible();
});
