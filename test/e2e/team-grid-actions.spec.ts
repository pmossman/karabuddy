import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, uploadReplay } from './helpers';

// B100: the team replay browser should show how much discussion each replay
// has *for this team* (team-scoped comment count), and let the replay's owner
// un-share it straight from the row kebab.

test('team grid surfaces the team-scoped comment count', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Scout', email: 'scout@example.com' });
  const { slug: team } = await createTeam(page, 'Scout Team');
  const r = await uploadReplay(page.request, {
    local: { username: 'Scout' },
    opponent: { username: 'Rival' },
    shareTeamSlugs: [team],
  });
  // A comment scoped to the team (what the team actually sees).
  const res = await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'Scout', frameIndex: 0, comment: 'scouting note', teamSlugs: [team] },
  });
  expect(res.ok(), `tag failed: ${res.status()}`).toBe(true);

  await page.goto(`/teams/${team}?tab=replays`);
  await expect(page.getByTestId(`replay-comment-count-${r.slug}`)).toContainText('1');
});

test('owner can un-share their own replay from the team grid kebab', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Owner', email: 'owner@example.com' });
  const { slug: team } = await createTeam(page, 'Squad');
  // Shared with the team, but no team-scoped tag — so the only thing keeping
  // it on the team grid is the explicit share.
  const r = await uploadReplay(page.request, {
    local: { username: 'Owner' },
    opponent: { username: 'Opp' },
    shareTeamSlugs: [team],
  });

  await page.goto(`/teams/${team}?tab=replays`);
  await expect(page.getByTestId(`row-actions-${r.slug}`)).toBeVisible();

  // The owner can flip the share off right from the kebab (canManage is false
  // grid-wide, but they own this replay).
  await page.getByTestId(`row-actions-${r.slug}`).click();
  const menu = page.getByTestId(`row-menu-${r.slug}`);
  const toggle = menu.getByRole('checkbox', { name: 'Squad' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  // Persisted: reload → the replay is no longer surfaced to the team.
  await page.reload();
  await expect(page.getByTestId(`row-actions-${r.slug}`)).toHaveCount(0);
});

test('un-sharing a replay that has team-scoped comments confirms, then fully un-shares', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Coach', email: 'coach@example.com' });
  const { slug: team } = await createTeam(page, 'Roster');
  const r = await uploadReplay(page.request, {
    local: { username: 'Coach' },
    opponent: { username: 'Opp' },
    shareTeamSlugs: [team],
  });
  // A comment scoped to the team — un-sharing must warn it'll be untagged.
  const res = await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'Coach', frameIndex: 0, comment: 'film note', teamSlugs: [team] },
  });
  expect(res.ok(), `tag failed: ${res.status()}`).toBe(true);

  await page.goto(`/teams/${team}?tab=replays`);
  await expect(page.getByTestId(`replay-comment-count-${r.slug}`)).toContainText('1');

  await page.getByTestId(`row-actions-${r.slug}`).click();
  const menu = page.getByTestId(`row-menu-${r.slug}`);
  await menu.getByRole('checkbox', { name: 'Roster' }).click();

  // Confirmation explains the consequence (the scoped comment gets untagged).
  // B204: now the shared ConfirmDialog (role=dialog; confirm button testid).
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(/1 comment/i);
  await page.getByTestId('confirm-dialog-confirm').click();

  // Full un-share: even though it had a team-scoped comment, it's gone from
  // the team grid (the scope was stripped too).
  await page.reload();
  await expect(page.getByTestId(`row-actions-${r.slug}`)).toHaveCount(0);
});
