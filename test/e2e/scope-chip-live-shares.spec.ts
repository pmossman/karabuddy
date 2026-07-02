import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, uploadReplay } from './helpers';

// Regression: the composer's "Visible to" scope pills must track LIVE share
// state, not the shares as they were at page load. Previously ShareWithTeam
// kept its un-share purely in its own local state, while `armedTeams` (which
// drives the pills + the default tag audience) was fetched once via GET /tags
// and never refreshed — so after un-sharing in-session the composer still
// claimed the comment would reach both teams. (The server clamps on submit,
// so the stored tag was actually personal; the bug was the misleading
// preview.)
// (B216 cutover briefly disconnected this wiring; it's re-threaded
// ShareFeature → RedesignChrome → ReplayViewer.setArmedTeams.)
test('scope pills reflect shares un-toggled in the same session', async ({ page }) => {
  const { userId } = await signInAsTestUser(page, { name: 'ScopeOwner', email: 'scope@example.com' });
  const { slug: teamA } = await createTeam(page, 'Team Alpha');
  const { slug: teamB } = await createTeam(page, 'Team Bravo');

  // Upload via page.request so the replay is owned by the signed-in user
  // (replay.userId === session user → isOwner is true, so the Share view's
  // owner controls render).
  const { slug } = await uploadReplay(page.request, {
    local: { username: 'ScopeOwner' },
    opponent: { username: 'Opp' },
  });
  for (const teamSlug of [teamA, teamB]) {
    const res = await page.request.post(`/api/replays/${slug}/team-shares`, { data: { teamSlug } });
    expect(res.ok(), `share with ${teamSlug} failed: ${res.status()}`).toBe(true);
  }

  await page.goto(`/r/${slug}`);
  await expect(page.getByTestId('board')).toHaveAttribute('data-frames', '1');

  // Baseline: open the Tag HUD composer — the scope pills show because the
  // replay is shared with two of my teams.
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await page.getByRole('button', { name: 'Add tag' }).click();
  await expect(page.getByRole('button', { name: 'Team Alpha', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Team Bravo', exact: true })).toBeVisible();

  // Un-share both teams via the panel's Share view, with the composer still
  // open (the HUD floats independently of the docked panel).
  await page.getByRole('button', { name: 'Sidebar' }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Team Alpha' }).uncheck();
  await page.getByRole('checkbox', { name: 'Team Bravo' }).uncheck();

  // The pills must disappear live — nothing left to scope to, so a new tag
  // defaults to personal.
  await expect(page.getByText('Visible to', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Team Alpha', exact: true })).toHaveCount(0);

  expect(userId).toBeTruthy();
});
