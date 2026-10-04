import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser } from './helpers';

const letter = (page: Page) => page.getByRole('dialog', { name: 'The future of KaraBuddy' });

test('the SWU Forge letter opens once per account, and the hub reopens it', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const email = `letter-${randomUUID().slice(0, 8)}@example.com`;
  await signInAsTestUser(page, { email, showAnnouncement: true });

  // The extension's sign-in popup closes itself, so the letter waits for a real page.
  await page.goto('/?fromExtension=1');
  await page.waitForLoadState('networkidle');
  await expect(letter(page)).toHaveCount(0);

  await page.goto('/');
  await expect(letter(page)).toBeVisible();
  await expect(letter(page)).toBeFocused();

  const saved = page.waitForResponse((r) => r.url().endsWith('/api/me/announcement-dismissal') && r.ok());
  await letter(page).getByRole('button', { name: 'Close' }).click();
  await saved;
  await expect(letter(page)).toHaveCount(0);

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(letter(page)).toHaveCount(0);

  const elsewhere = await browser.newContext();
  const otherPage = await elsewhere.newPage();
  await signInAsTestUser(otherPage, { email, showAnnouncement: true });
  await otherPage.goto('/');
  await otherPage.waitForLoadState('networkidle');
  await expect(letter(otherPage)).toHaveCount(0);
  await elsewhere.close();

  await page.getByRole('link', { name: 'SWU Forge', exact: true }).first().click();
  await expect(page).toHaveURL(/\/swu-forge$/);

  const reopen = page.getByRole('button', { name: 'The future of KaraBuddy' });
  await reopen.click();
  await expect(letter(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(letter(page)).toHaveCount(0);
  await expect(reopen).toBeFocused();
});
