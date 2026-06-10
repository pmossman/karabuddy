import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B121-followup: the header "Install extension" CTA must NOT show once an account
// has a linked extension (they've clearly onboarded). Before the fix the CTA
// relied solely on a per-browser bridge probe — which never resolves in dev/test
// (no extension) and ignored the account's linked installs.

test('header install CTA hides once the account has a linked extension', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'CTA User' });

  // No linked extension yet + no extension in this browser → the probe times out
  // and the onboarding CTA surfaces.
  await page.goto('/replays');
  await expect(page.getByRole('link', { name: /Install extension/i })).toBeVisible({ timeout: 4000 });

  // Link an install to the account, then reload: server-side suppression kicks in.
  const { installToken } = await uploadReplay(request, {
    local: { username: 'CtaUser' },
    opponent: { username: 'Other' },
  });
  await claimInstallToken(page, installToken);

  await page.goto('/replays');
  await expect(page.getByRole('link', { name: /Install extension/i })).toHaveCount(0);
});
