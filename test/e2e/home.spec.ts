import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, uploadReplay, claimInstallToken } from './helpers';

// B70: home page redesign around the teams experience.
// - Signed-in members see per-team activity sections up top, each a
//   stable link into the full team page.
// - Everyone signed-in sees their most recent recorded replays.
// - The /claim pitch is gone (linking is fully automated now).
// - Signed-out visitors lead with their (anonymous) recent replays.

// Team-centric revamp: a signed-in member's home redirects straight to their
// active team's dashboard, which surfaces the team's recent activity.
test('signed-in member: home redirects to the team dashboard, which surfaces activity', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'HomeMember', email: 'home-member@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Home Squad');

  const r = await uploadReplay(request, { local: { username: 'HomeMember' }, opponent: { username: 'TeamFoe' } });
  await claimInstallToken(page, r.installToken);
  await page.request.post(`/api/replays/${r.slug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': r.installToken },
  });
  await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'HomeMember', frameIndex: 0, comment: 'home feed comment' },
  });

  await page.goto('/');
  await page.waitForURL(new RegExp(`/teams/${teamSlug}$`));
  await expect(page.getByRole('heading', { name: 'Home Squad' })).toBeVisible();
  // The dashboard's Discussion feed surfaces the recent comment.
  await expect(page.getByRole('main').getByText('home feed comment')).toBeVisible();
});

test('signed-in: home shows the most recent recorded replays', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'RecentRecorder', email: 'recent@example.com' });
  const r = await uploadReplay(request, { local: { username: 'RecentRecorder' }, opponent: { username: 'RecentOpp' } });
  await claimInstallToken(page, r.installToken);

  await page.goto('/');

  const recent = page.getByTestId('home-recent-replays');
  await expect(recent).toBeVisible();
  await expect(recent).toContainText('RecentOpp');
});

test('home no longer pitches the /claim flow', async ({ page }) => {
  await signInAsTestUser(page, { name: 'NoClaim', email: 'noclaim@example.com' });
  await page.goto('/');
  await expect(page.locator('a[href="/claim"]')).toHaveCount(0);
});

test('signed-in with no team: home nudges to start a team and still shows replays', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Teamless', email: 'teamless@example.com' });
  const r = await uploadReplay(request, { local: { username: 'Teamless' }, opponent: { username: 'SoloOpp' } });
  await claimInstallToken(page, r.installToken);

  await page.goto('/');

  await expect(page.getByTestId('home-team-section')).toHaveCount(0);
  await expect(page.getByTestId('home-team-cta')).toBeVisible();
  await expect(page.getByTestId('home-recent-replays')).toContainText('SoloOpp');
});
