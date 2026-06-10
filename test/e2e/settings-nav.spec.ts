import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers';

// B83: avatar dropdown (account actions behind the avatar) + Slack-style
// sectioned settings rail.

test('header avatar menu holds Settings + Sign out (hidden until opened)', async ({ page }) => {
  await signInAsTestUser(page, { name: 'MenuUser', email: 'menu@example.com' });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Account menu' });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0); // closed
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  // The old always-visible header "Settings" nav link is gone.
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Settings' })).toHaveCount(0);
});

test('settings rail navigates between the four sections', async ({ page }) => {
  await signInAsTestUser(page, { name: 'RailUser', email: 'rail@example.com' });
  await page.goto('/settings');
  const rail = page.getByTestId('settings-nav');

  // Account is the default section (B84: just the Discord card — no karabast username).
  await expect(page.getByRole('heading', { name: 'Discord', exact: true })).toBeVisible();

  await rail.getByRole('link', { name: 'Notifications' }).click();
  await expect(page.getByRole('heading', { name: /Discord notifications/i })).toBeVisible();

  await rail.getByRole('link', { name: 'Teams' }).click();
  await expect(page.getByRole('heading', { name: /Team notifications/i })).toBeVisible();

  await rail.getByRole('link', { name: 'Extension' }).click();
  await expect(page.getByRole('heading', { name: /Linked extensions/i })).toBeVisible();
});
