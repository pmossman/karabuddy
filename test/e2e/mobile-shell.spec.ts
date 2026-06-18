import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam } from './helpers';

// Regression guard: on a phone the signed-in sidebar shell stacks as a column
// (top bar → content), so the page content is full-width — NOT squeezed into a
// flex item beside the sticky mobile bar (the shipped-then-fixed mobile bug).
test('mobile: signed-in content is full-width, not squeezed beside the sidebar', async ({ page }) => {
  await signInAsTestUser(page, { name: 'MobileShell' });
  const { slug } = await createTeam(page, 'Shell Team');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/teams/${slug}?tab=members`);

  // The AppShell content wrapper (outer main); the team page nests its own main.
  const box = await page.getByRole('main').first().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(330); // ~full 390 viewport, not ~half
});
