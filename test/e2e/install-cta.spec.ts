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

// Browser extensions don't exist on mobile browsers, so the CTA must never show
// on a touch device — even with no linked extension (the case that surfaces it
// on desktop).
test.describe('touch device', () => {
  // isMobile + hasTouch drives chromium's mobile emulation, which reports
  // `(hover: none) and (pointer: coarse)` — the signal the CTA suppresses on.
  test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });

  test('the replay-viewer install banner is suppressed on phones', async ({ page, request }) => {
    const { slug } = await uploadReplay(request, {
      local: { username: 'TouchP1' },
      opponent: { username: 'TouchP2' },
    });
    await page.goto(`/r/${slug}`);
    // Give the (suppressed) probe well past its 1.5s timeout — it must stay hidden.
    await page.waitForTimeout(2000);
    await expect(page.getByText('Want to record replays of your own matches?')).toHaveCount(0);
  });
});
