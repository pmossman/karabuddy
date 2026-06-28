import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, createTeam, generateInvite, uploadReplay, claimInstallToken } from './helpers';

// B194: the viewer-side "Finish review" flow. The owner requests a team review;
// a teammate leaves a team-scoped comment, then uses the Review panel's "Finish
// review →" button to open a summary modal of their comments and submit — which
// marks the review done (per-user, durable) and flips the header to "You
// reviewed". (The requester DM is fired best-effort server-side; gated off here —
// the e2e build has no bot token and isn't a prod deploy, so nothing leaves.)

test('teammate finishes a review from the summary modal → header flips to reviewed', async ({ page, browser, request }) => {
  await signInAsTestUser(page, { name: 'FROwner', email: 'fr-owner@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Finish Squad');
  const { code } = await generateInvite(page, teamSlug);

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signInAsTestUser(page2, { name: 'FRMate', email: 'fr-mate@example.com' });
  await page2.goto(`/teams/join?code=${code}`);
  await page2.waitForURL(new RegExp(`/teams/${teamSlug}`));

  // Owner uploads a replay shared with the team, then requests a review.
  const ownerToken = `kbx_${randomUUID()}`;
  await claimInstallToken(page, ownerToken);
  const { slug } = await uploadReplay(request, {
    installToken: ownerToken,
    local: { username: 'FROwner' },
    opponent: { username: 'Opp' },
    shareTeamSlugs: [teamSlug],
  });
  const reqRes = await page.request.post(`/api/replays/${slug}/review`, {
    data: { teamSlug, requested: true },
  });
  expect(reqRes.ok(), `request review failed: ${reqRes.status()}`).toBe(true);

  // Teammate leaves a team-scoped comment (their claimed token attributes the
  // userId, so it's "their" comment in both the gate and the modal).
  const mateToken = `kbx_${randomUUID()}`;
  await claimInstallToken(page2, mateToken);
  const tagRes = await page2.request.post(`/api/replays/${slug}/tags`, {
    data: { installToken: mateToken, authorName: 'FRMate', frameIndex: 2, comment: 'overextended into the sweep', teamSlugs: [teamSlug] },
  });
  expect(tagRes.ok(), `tag failed: ${tagRes.status()}`).toBe(true);

  // Open the viewer's Review panel — the status header offers "Finish review →"
  // because the teammate has commented but not yet marked reviewed.
  await page2.goto(`/r/${slug}`);
  await page2.getByRole('button', { name: /^Review/ }).click();
  const finishBtn = page2.getByTestId(`viewer-finish-review-${teamSlug}`);
  await expect(finishBtn).toContainText('Finish review');
  await expect(finishBtn).toBeEnabled();
  await finishBtn.click();

  // The summary modal lists the teammate's comment; submitting marks it done.
  const modal = page2.getByRole('dialog', { name: /Finish review for Finish Squad/ });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('1 comment');
  await expect(modal).toContainText('overextended into the sweep');
  await modal.getByRole('button', { name: 'Submit review' }).click();

  // Modal closes and the header flips to the reviewed/undo state.
  await expect(modal).toBeHidden();
  await expect(finishBtn).toContainText('You reviewed');

  await ctx2.close();
});
