import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers';

// The header overflowed off-screen on phones (centered nav + right cluster wider
// than the viewport). Below the 720px breakpoint the inline nav collapses into a
// hamburger; above it the inline nav shows and the hamburger is hidden.

test('mobile: nav collapses into a hamburger menu', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Mobile Nav' });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/replays');

  // Inline nav is hidden; hamburger is shown; the dropdown isn't mounted yet.
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);

  // Open it → the nav links live inside the dropdown menu.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Stats' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Teams' })).toBeVisible();

  // Navigating from the menu closes it.
  await menu.getByRole('menuitem', { name: 'Stats' }).click();
  await expect(page).toHaveURL(/\/stats/);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('desktop: inline nav is shown and the hamburger is hidden', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Desktop Nav' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/replays');

  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Stats' })).toBeVisible();
});
