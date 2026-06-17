import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers';

// Team-centric revamp: signed-in users get the left sidebar, which collapses
// below the breakpoint into a hamburger that opens the nav as a slide-in drawer.

test('mobile: the sidebar collapses into a hamburger drawer', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Mobile Nav' });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/replays');

  // Sidebar column is hidden; the hamburger is shown; the drawer isn't mounted.
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);

  // Open it → the nav links live inside the slide-in drawer.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('link', { name: 'My replays', exact: true })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'My stats', exact: true })).toBeVisible();

  // Navigate from the drawer — navigation also closes it.
  await menu.getByRole('link', { name: 'My stats', exact: true }).click();
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
