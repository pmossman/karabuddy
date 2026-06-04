import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers';

// B101: /stats is scoped to the signed-in user + their teams — NO global/
// community view. Signed out, it prompts sign-in; signed in, it shows the
// scope switcher (Mine, no Global) and the view tabs.
test('stats page prompts sign-in when signed out — no global view', async ({ page }) => {
  await page.goto('/stats');
  await expect(page.getByRole('heading', { name: /Meta\s*Stats/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/sign in to see your personal and team stats/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Global' })).toHaveCount(0);
});

test('signed in, stats shows the scoped surface (Mine, no Global) + view tabs', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Stats Tester' });
  await page.goto('/stats');
  await expect(page.getByRole('button', { name: 'Mine' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Global' })).toHaveCount(0);
  for (const tab of ['Leaders', 'Matchups', 'Cards', 'Resourcing']) {
    await expect(page.getByRole('button', { name: tab })).toBeVisible();
  }
  // Matchups view exposes the heatmap lens (leader-vs-leader / deck-vs-deck).
  await page.getByRole('button', { name: 'Matchups' }).click();
  await expect(page.getByRole('button', { name: 'Leaders & Bases' })).toBeVisible();
});

test('Stats appears in the header nav', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Stats' })).toBeVisible();
});
