import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, generateInvite, uploadReplay, claimInstallToken } from './helpers';

// Teams data-model + invite flow + replay surfacing.

test('owner can rename their team', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Owner' });
  const { slug } = await createTeam(page, 'Original Name');

  const renameRes = await page.request.patch(`/api/teams/${slug}`, {
    data: { name: 'Renamed Team' },
  });
  expect(renameRes.ok()).toBe(true);

  await page.goto(`/teams/${slug}`);
  await expect(page.getByRole('heading', { name: 'Renamed Team' })).toBeVisible();
});

test('last-owner-leaving guard refuses', async ({ page }) => {
  await signInAsTestUser(page, { name: 'SoleOwner' });
  const { slug } = await createTeam(page, 'Solo');

  const leaveRes = await page.request.delete(`/api/teams/${slug}`);
  expect(leaveRes.status()).toBe(400);
});

test('invite + accept: second user joins as member', async ({ page, browser }) => {
  // Owner creates a team + an invite. (Use a name distinct from the
  // 'Owner' role chip so member-list assertions stay unambiguous.)
  await signInAsTestUser(page, { name: 'CreatorA', email: 'owner-e2e@example.com' });
  const { slug } = await createTeam(page, 'Invite Test');
  const { code } = await generateInvite(page, slug);

  // Second user (separate browser context = separate session) accepts.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signInAsTestUser(page2, { name: 'Invitee', email: 'invitee-e2e@example.com' });

  await page2.goto(`/teams/join?code=${code}`);
  await page2.waitForURL(new RegExp(`/teams/${slug}`));
  // 'Owner' substring also appears in the empty-state text ('team owner');
  // navigate to the Members tab so the member-list rows render where it
  // does match.
  await page2.goto(`/teams/${slug}?tab=members`);
  await expect(page2.getByText('Owner', { exact: true })).toBeVisible();
  await expect(page2.getByText('Invitee')).toBeVisible();
  await expect(page2.getByText(/2 members/)).toBeVisible();

  await ctx2.close();
});

test('team replay surfaces when shared — not merely when a member tags it (B71)', async ({ page, browser, request }) => {
  // Setup: owner creates team, uploads replay, claims it.
  await signInAsTestUser(page, { name: 'OwnerA', email: 'owner-ts-a@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Team Surface');
  const { code } = await generateInvite(page, teamSlug);

  const { slug: replaySlug, installToken } = await uploadReplay(request, {
    local: { username: 'OwnerA' },
    opponent: { username: 'Opp' },
  });
  await claimInstallToken(page, installToken);

  // User B accepts invite.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await signInAsTestUser(pageB, { name: 'TeammateB', email: 'tm-b@example.com' });
  const joinRes = await pageB.request.post('/api/teams/join', { data: { code } });
  expect(joinRes.ok()).toBe(true);

  // Initially Replays tab is empty.
  await pageB.goto(`/teams/${teamSlug}?tab=replays`);
  await expect(pageB.getByText(/No team replays yet/)).toBeVisible();

  // B71: tagging an UNSHARED replay no longer surfaces it — the comment is
  // personal (scope defaults to the replay's shares, of which there are
  // none). This is the leak fix: a member's tag must not drag the replay
  // into the team.
  const tagRes = await pageB.request.post(`/api/replays/${replaySlug}/tags`, {
    data: { installToken: 'kbx_b', authorName: 'TeammateB', frameIndex: 0, comment: 'interesting play' },
  });
  expect(tagRes.ok()).toBe(true);
  await pageB.reload();
  await expect(pageB.getByText(/No team replays yet/)).toBeVisible();

  // Explicitly sharing the replay with the team is what surfaces it.
  const shareRes = await page.request.post(`/api/replays/${replaySlug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': installToken },
  });
  expect(shareRes.ok()).toBe(true);

  await pageB.reload();
  await expect(pageB.getByText(/OwnerA.*vs.*Opp|Opp.*vs.*OwnerA/).first()).toBeVisible({ timeout: 5000 });

  await ctxB.close();
});
