import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// Tagging is account-gated. A signed-out viewer used to be able to leave
// anonymous comments that can NEVER become a review (the review gate keys on
// tags.userId) — so after signing in to "Finish review" they had no logged-in
// comments and the button did nothing.
//
// B216: the compose surface is the Tag HUD. For a signed-out viewer the HUD's
// "Add tag" control is disabled (canTag = server-side entitlement, and an
// anonymous viewer is never entitled), so the composer can't open at all.
//
// NOTE / gap: the old dedicated sign-in CTA (tag-signin-gate / tag-signin-cta,
// still in tagCompose.SignInToTagCta) is currently UNREACHABLE — it only
// renders inside an OPEN composer when canTag && !signedIn, but canTag implies
// a signed-in entitled viewer, so no code path shows it to an anonymous
// visitor anymore. When the CTA is re-wired, re-assert it here.

test('signed-out viewer cannot open the tag composer (tagging is sign-in gated)', async ({ page, request }) => {
  const { slug } = await uploadReplay(request, {
    local: { username: 'Owner', leaderName: 'Luke Skywalker' },
    opponent: { username: 'Opp', leaderName: 'Grand Admiral Thrawn' },
    match: { gameFormat: 'premier', gamesToWinMode: 'bestOfOne' },
  });
  await page.goto(`/r/${slug}`);
  await expect(page.getByTestId('board')).toHaveAttribute('data-frames', '1');

  // Open the Tag HUD — Add stays clickable for the signed-out viewer, but opens
  // the sign-in CTA (the prod affordance) instead of the composer.
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await page.getByRole('button', { name: 'Add tag' }).click();
  await expect(page.getByTestId('tag-signin-gate')).toBeVisible();
  await expect(page.getByTestId('tag-signin-cta')).toHaveAttribute('href', new RegExp(`/signin\\?callbackUrl=.*${slug}`));
  // The real composer never opens for a signed-out viewer.
  await expect(page.locator('textarea')).toHaveCount(0);
});

test('signed-in owner still gets the tag composer (gate only affects anon)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'TagUser', email: `tag-${randomUUID().slice(0, 6)}@example.com` });
  const r = await uploadReplay(request, { local: { username: 'TagUser' }, opponent: { username: 'Opp' } });
  await claimInstallToken(page, r.installToken);
  await page.goto(`/r/${r.slug}`);
  await expect(page.getByTestId('board')).toHaveAttribute('data-frames', '1');

  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add tag' })).toBeEnabled();
  await page.getByRole('button', { name: 'Add tag' }).click();
  // The real composer (not the sign-in gate) renders once the session loads.
  await expect(page.getByPlaceholder(/Your note about this moment/)).toBeVisible();
  await expect(page.getByTestId('tag-signin-gate')).toHaveCount(0);
});
