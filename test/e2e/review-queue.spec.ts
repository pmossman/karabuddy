import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, createTeam, generateInvite, uploadReplay, claimInstallToken } from './helpers';

// B149 / ADR 0009: the uploader requests a team review; it stays in the team's
// Reviews tab (durable). A member can only "I reviewed" after they've commented,
// and marking it reviewed does NOT remove it — it moves to Reviewed (more eyes
// welcome), with the reviewer count climbing.

test('request → comment-gated review → durable (does not vanish)', async ({ page, browser, request }) => {
  await signInAsTestUser(page, { name: 'RQOwner', email: 'rq-owner@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Review Squad');
  const { code } = await generateInvite(page, teamSlug);

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signInAsTestUser(page2, { name: 'RQMate', email: 'rq-mate@example.com' });
  await page2.goto(`/teams/join?code=${code}`);
  await page2.waitForURL(new RegExp(`/teams/${teamSlug}`));

  const ownerToken = `kbx_${randomUUID()}`;
  await claimInstallToken(page, ownerToken);
  const { slug } = await uploadReplay(request, {
    installToken: ownerToken,
    local: { username: 'RQOwner' },
    opponent: { username: 'Opp' },
    shareTeamSlugs: [teamSlug],
  });

  // Owner requests review from the viewer's Share view (B216: the sidebar
  // panel's Share view replaced the old Share popover; the review star lives on
  // the shared team's row there).
  await page.goto(`/r/${slug}?panel=share`);
  const requestBtn = page.getByTestId(`request-review-${teamSlug}`);
  await expect(requestBtn).toContainText('Request team review');
  await requestBtn.click();
  await expect(page.getByTestId(`request-review-${teamSlug}`)).toContainText(/In review queue/, { timeout: 5000 });

  // Teammate sees it under "Awaiting your review", but can't mark it reviewed
  // until they've commented (the gate).
  await page2.goto(`/teams/${teamSlug}?tab=review`);
  await expect(page2.getByTestId('review-queue-item')).toHaveCount(1);
  const markBtn = page2.getByTestId(`mark-reviewed-${slug}`);
  await expect(markBtn).toContainText(/Comment to review/);
  await expect(markBtn).toBeDisabled();

  // Teammate leaves a team-scoped comment (their session attributes the userId).
  const mateToken = `kbx_${randomUUID()}`;
  await claimInstallToken(page2, mateToken);
  const tagRes = await page2.request.post(`/api/replays/${slug}/tags`, {
    data: { installToken: mateToken, authorName: 'RQMate', frameIndex: 0, comment: 'good line here', teamSlugs: [teamSlug] },
  });
  expect(tagRes.ok()).toBeTruthy();

  // Now the gate opens — the action flips from the disabled "Comment to review"
  // to an enabled "Finish review →" (B194: it deep-links into the viewer's
  // summary modal; that nav + submit is covered in finish-review.spec). Here we
  // complete it directly to assert the QUEUE's durability + filter behavior.
  await page2.reload();
  const markBtn2 = page2.getByTestId(`mark-reviewed-${slug}`);
  await expect(markBtn2).toContainText(/Finish review/);
  await expect(markBtn2).toBeEnabled();
  const done = await page2.request.post(`/api/replays/${slug}/reviewed`, { data: { teamSlug, reviewed: true } });
  expect(done.ok(), `mark reviewed failed: ${done.status()}`).toBe(true);

  // It LEAVES "Awaiting your review" (you've reviewed it) but does NOT vanish —
  // it's still there under "Reviewed", marked as reviewed by you.
  await page2.reload();
  await expect(page2.getByTestId('review-queue-item')).toHaveCount(0);
  await page2.getByTestId('review-filter-reviewed').click();
  await expect(page2.getByTestId('review-queue-item')).toHaveCount(1);
  // B195: no "undo" — a finished review now offers an UPDATE (re-notifies).
  await expect(page2.getByTestId(`mark-reviewed-${slug}`)).toContainText(/Update review/);

  await ctx2.close();
});
