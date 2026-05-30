import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, generateInvite, uploadReplay, claimInstallToken } from './helpers';

// @-mention end-to-end: A tags B in a comment on A's replay → B sees
// it in their /mentions inbox.

test("mention surfaces in mentioned user's inbox", async ({ page, browser, request }) => {
  await signInAsTestUser(page, { name: 'Mentioner', email: 'mention-a@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Mention Team');
  const { code } = await generateInvite(page, teamSlug);

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const { userId: userB } = await signInAsTestUser(pageB, { name: 'Mentionee', email: 'mention-b@example.com' });
  await pageB.request.post('/api/teams/join', { data: { code } });

  const { slug: replaySlug, installToken } = await uploadReplay(request, {
    local: { username: 'Mentioner' },
    opponent: { username: 'X' },
  });
  await claimInstallToken(page, installToken);

  // B71: a mention only reaches B if the comment is scoped to a team B is
  // in. Sharing the replay with the team makes the team the comment's
  // default audience, so the unscoped tag below scopes to it.
  await page.request.post(`/api/replays/${replaySlug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': installToken },
  });

  const tagRes = await page.request.post(`/api/replays/${replaySlug}/tags`, {
    data: {
      installToken,
      authorName: 'Mentioner',
      frameIndex: 0,
      comment: 'Hey @Mentionee, look at this',
      mentions: { userIds: [userB], teamSlugs: [] },
    },
  });
  expect(tagRes.ok()).toBe(true);

  await pageB.goto('/mentions');
  await expect(pageB.getByText(/Hey.*Mentionee.*look at this/)).toBeVisible({ timeout: 5000 });
  // 'Mentioner' appears in both the author byline and the "Mentioner vs X"
  // teaser — first() is enough to prove the inbox rendered the entry.
  await expect(pageB.getByText('Mentioner').first()).toBeVisible();

  // Click the mention → lands on the replay viewer at frame 1.
  await pageB.getByText(/Hey.*Mentionee.*look at this/).click();
  await pageB.waitForURL(/\/r\/[a-z0-9]+/);
  await expect(pageB.getByText(/Frame 1 \/ 1/)).toBeVisible();

  await ctxB.close();
});

test('teams-mention-data endpoint returns members + teams', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Solo', email: 'solo-m@example.com' });
  const { slug } = await createTeam(page, 'My Team');

  const res = await page.request.get('/api/me/teams-mention-data');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.teams.map((t: any) => t.slug)).toContain(slug);
  expect(body.members.map((m: any) => m.displayName)).toContain('Solo');
});
