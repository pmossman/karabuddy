import { test, expect, type Page, type BrowserContext, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, createTeam, generateInvite, uploadReplay, claimInstallToken } from './helpers';

// B194: the "Finish review" flow. The owner requests a team review; a teammate
// leaves a team-scoped comment, then completes the review through a summary modal
// of their comments — reachable two ways, both landing in the SAME modal:
//   1. inside the viewer's Review panel ("Finish review →"), and
//   2. from the team Reviews tab, which deep-links into the viewer (?finishReview)
//      and auto-opens the modal.
// Submitting marks it done (per-user, durable) and flips the header to "You
// reviewed". (The requester DM fires best-effort server-side; gated off in tests —
// no bot token + not a prod deploy, so nothing leaves.)

// Owner requests review on a shared replay; a teammate comments. Returns the
// teammate's page (signed in, on the team) + the replay/team slugs.
async function seedRequestedReview(page: Page, browser: import('@playwright/test').Browser, request: APIRequestContext) {
  await signInAsTestUser(page, { name: 'FROwner', email: `fr-owner-${randomUUID().slice(0, 6)}@example.com` });
  const { slug: teamSlug } = await createTeam(page, 'Finish Squad');
  const { code } = await generateInvite(page, teamSlug);

  const ctx2: BrowserContext = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signInAsTestUser(page2, { name: 'FRMate', email: `fr-mate-${randomUUID().slice(0, 6)}@example.com` });
  await page2.goto(`/teams/join?code=${code}`);
  await page2.waitForURL(new RegExp(`/teams/${teamSlug}`));

  const ownerToken = `kbx_${randomUUID()}`;
  await claimInstallToken(page, ownerToken);
  const { slug } = await uploadReplay(request, {
    installToken: ownerToken,
    local: { username: 'FROwner' },
    opponent: { username: 'Opp' },
    shareTeamSlugs: [teamSlug],
  });
  const reqRes = await page.request.post(`/api/replays/${slug}/review`, { data: { teamSlug, requested: true } });
  expect(reqRes.ok(), `request review failed: ${reqRes.status()}`).toBe(true);

  // Teammate leaves a team-scoped comment (their claimed token attributes the
  // userId, so it's "their" comment in both the gate and the modal).
  const mateToken = `kbx_${randomUUID()}`;
  await claimInstallToken(page2, mateToken);
  const tagRes = await page2.request.post(`/api/replays/${slug}/tags`, {
    data: { installToken: mateToken, authorName: 'FRMate', frameIndex: 2, comment: 'overextended into the sweep', teamSlugs: [teamSlug] },
  });
  expect(tagRes.ok(), `tag failed: ${tagRes.status()}`).toBe(true);

  return { teamSlug, slug, page2, ctx2 };
}

test('teammate finishes a review from the viewer Review panel', async ({ page, browser, request }) => {
  const { teamSlug, slug, page2, ctx2 } = await seedRequestedReview(page, browser, request);

  await page2.goto(`/r/${slug}`);
  await page2.getByRole('button', { name: /^Review/ }).click();
  const finishBtn = page2.getByTestId(`viewer-finish-review-${teamSlug}`);
  await expect(finishBtn).toContainText('Finish review');
  await expect(finishBtn).toBeEnabled();
  await finishBtn.click();

  const modal = page2.getByRole('dialog', { name: /Finish review for Finish Squad/ });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('1 comment');
  await expect(modal).toContainText('overextended into the sweep');
  await modal.getByRole('button', { name: 'Submit review' }).click();

  await expect(modal).toBeHidden();
  await expect(finishBtn).toContainText('You reviewed');

  await ctx2.close();
});

test('Reviews-tab "Finish review →" deep-links into the viewer and auto-opens the summary', async ({ page, browser, request }) => {
  const { teamSlug, slug, page2, ctx2 } = await seedRequestedReview(page, browser, request);

  await page2.goto(`/teams/${teamSlug}?tab=review`);
  const queueBtn = page2.getByTestId(`mark-reviewed-${slug}`);
  await expect(queueBtn).toContainText('Finish review');
  await queueBtn.click();

  // Lands on the viewer with the summary modal already open (from ?finishReview).
  await page2.waitForURL(new RegExp(`/r/${slug}`));
  const modal = page2.getByRole('dialog', { name: /Finish review for Finish Squad/ });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('overextended into the sweep');
  await modal.getByRole('button', { name: 'Submit review' }).click();

  await expect(modal).toBeHidden();
  await expect(page2.getByTestId(`viewer-finish-review-${teamSlug}`)).toContainText('You reviewed');

  await ctx2.close();
});
