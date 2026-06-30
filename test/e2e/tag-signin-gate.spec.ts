import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// Tagging is account-gated. A signed-out viewer used to be able to leave
// anonymous comments that can NEVER become a review (the review gate keys on
// tags.userId) — so after signing in to "Finish review" they had no logged-in
// comments and the button did nothing. The tag section now shows a sign-in CTA
// (returning to this replay) for signed-out viewers instead of the tag form.

test('signed-out viewer gets a sign-in CTA, not the tag form', async ({ page, request }) => {
  const { slug } = await uploadReplay(request, {
    local: { username: 'Owner', leaderName: 'Luke Skywalker' },
    opponent: { username: 'Opp', leaderName: 'Grand Admiral Thrawn' },
    match: { gameFormat: 'premier', gamesToWinMode: 'bestOfOne' },
  });
  await page.goto(`/r/${slug}`);
  await page.getByRole('button', { name: /^Tags/ }).click();

  // The CTA replaces the tag form; "+ Tag this frame" is gone for anon.
  await expect(page.getByTestId('tag-signin-gate')).toBeVisible();
  await expect(page.getByRole('button', { name: /Tag this frame/i })).toHaveCount(0);
  // And it deep-links to sign-in, returning to this replay afterwards.
  const cta = page.getByTestId('tag-signin-cta');
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('href', new RegExp(`/signin\\?callbackUrl=.*${slug}`));
});

test('signed-in viewer still gets the tag form (gate only affects anon)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'TagUser', email: `tag-${randomUUID().slice(0, 6)}@example.com` });
  const r = await uploadReplay(request, { local: { username: 'TagUser' }, opponent: { username: 'Opp' } });
  await claimInstallToken(page, r.installToken);
  await page.goto(`/r/${r.slug}`);
  await page.getByRole('button', { name: /^Tags/ }).click();

  await expect(page.getByRole('button', { name: /Tag this frame/i })).toBeVisible();
  await expect(page.getByTestId('tag-signin-gate')).toHaveCount(0);
});
