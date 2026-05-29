import { test, expect } from '@playwright/test';

// E2E — drives the actual browser through the test sign-in endpoint
// (no real OAuth) and verifies the /teams page renders with the
// real session cookie set. Proves the whole stack works:
// browser → dev server → DB → Auth.js session lookup → page render.
//
// More E2E tests can copy this scaffold; the signInAsTestUser helper
// lives in test/e2e/helpers.ts.

import { signInAsTestUser } from './helpers';

test('signed-in user can reach /teams and create one', async ({ page, request }) => {
  await signInAsTestUser(page, request, { name: 'Tester' });

  await page.goto('/teams');
  await expect(page.getByRole('heading', { name: 'Teams', level: 1 })).toBeVisible();
  await expect(page.getByText('Create a team')).toBeVisible();

  // Type a name + click Create — should redirect to /teams/<slug>.
  await page.getByPlaceholder(/Team name/).fill('E2E Team');
  await page.getByRole('button', { name: 'Create' }).click();

  await page.waitForURL(/\/teams\/[a-z0-9]+/);
  await expect(page.getByRole('heading', { name: 'E2E Team' })).toBeVisible();

  // New team lists the caller as the sole member.
  await expect(page.getByText('1 member')).toBeVisible();
});
