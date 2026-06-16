import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam } from './helpers';

// Phase A — the team-centric IA: active team in a cookie, `/` redirects to the
// active team's dashboard, the header switcher changes the active team, and the
// "You" menu reaches personal surfaces without changing it.

test('one-team user landing on / is redirected to their team dashboard', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Solo', email: 'solo-ctx@example.com' });
  const { slug } = await createTeam(page, 'Solo Squad');

  await page.goto('/');
  await page.waitForURL(new RegExp(`/teams/${slug}$`));
  await expect(page.getByRole('heading', { name: 'Solo Squad' })).toBeVisible();
});

test('multi-team user switches via the header; URL + dashboard follow and reload persists', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Multi', email: 'multi-ctx@example.com' });
  const { slug: alpha } = await createTeam(page, 'Alpha Squad');
  const { slug: bravo } = await createTeam(page, 'Bravo Squad');

  // No cookie yet → fallback is the first team by joinedAt (Alpha).
  await page.goto('/');
  await page.waitForURL(new RegExp(`/teams/${alpha}$`));
  await expect(page.getByRole('heading', { name: 'Alpha Squad' })).toBeVisible();

  // Switch to Bravo via the header switcher.
  await page.getByRole('button', { name: 'Switch team' }).click();
  await page.getByRole('menuitemradio', { name: 'Bravo Squad' }).click();
  await page.waitForURL(new RegExp(`/teams/${bravo}$`));
  await expect(page.getByRole('heading', { name: 'Bravo Squad' })).toBeVisible();

  // Cookie persists the switch: a fresh visit to / lands on Bravo, not Alpha.
  await page.goto('/');
  await page.waitForURL(new RegExp(`/teams/${bravo}$`));
  await expect(page.getByRole('heading', { name: 'Bravo Squad' })).toBeVisible();
});

test('You menu opens personal replays without changing the active team', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Ambient', email: 'ambient-ctx@example.com' });
  const { slug } = await createTeam(page, 'Ambient Squad');

  await page.goto(`/teams/${slug}`);
  await page.getByRole('button', { name: 'You' }).click();
  await page.getByRole('menuitem', { name: 'My replays' }).click();
  await expect(page).toHaveURL(/\/replays\?tab=mine/);

  // Active team is unchanged — / still redirects to the same team.
  await page.goto('/');
  await page.waitForURL(new RegExp(`/teams/${slug}$`));
});
