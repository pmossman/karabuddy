import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, createTeam, generateInvite, uploadReplay, claimInstallToken } from './helpers';

// B135: the uploader flags a shared replay for review by a team; it appears in
// that team's Review-queue tab, and any member can mark it reviewed.

test('request review → team queue → teammate marks reviewed', async ({ page, browser, request }) => {
  // Owner with a replay shared to their team; a teammate joins.
  await signInAsTestUser(page, { name: 'RQOwner', email: 'rq-owner@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Review Squad');
  const { code } = await generateInvite(page, teamSlug);

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signInAsTestUser(page2, { name: 'RQMate', email: 'rq-mate@example.com' });
  await page2.goto(`/teams/join?code=${code}`);
  await page2.waitForURL(new RegExp(`/teams/${teamSlug}`));

  const token = `kbx_${randomUUID()}`;
  await claimInstallToken(page, token);
  const { slug } = await uploadReplay(request, {
    installToken: token,
    local: { username: 'RQOwner' },
    opponent: { username: 'Opp' },
    shareTeamSlugs: [teamSlug],
  });

  // Owner requests review from the Share popover on the viewer.
  await page.goto(`/r/${slug}`);
  await page.getByTitle('Share', { exact: true }).click();
  const requestBtn = page.getByTestId(`request-review-${teamSlug}`);
  await expect(requestBtn).toBeVisible();
  await expect(requestBtn).toContainText('Request team review');
  await requestBtn.click();
  await expect(page.getByTestId(`request-review-${teamSlug}`)).toContainText(/In review queue/, { timeout: 5000 });

  // It shows in the team's Review queue (teammate's view).
  await page2.goto(`/teams/${teamSlug}?tab=review`);
  await expect(page2.getByTestId('review-queue-item')).toHaveCount(1);

  // The teammate marks it reviewed → it leaves the queue.
  await page2.getByTestId(`mark-reviewed-${slug}`).click();
  await expect(page2.getByTestId('review-queue-item')).toHaveCount(0);
  await expect(page2.getByText(/Nothing queued for review/)).toBeVisible();

  await ctx2.close();
});
