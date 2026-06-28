import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, uploadReplay } from './helpers';

// Regression: the comment "Visible to:" scope chip must track LIVE share
// state, not the shares as they were at page load. Previously ShareWithTeam
// kept its un-share purely in its own local state, while `armedTeams` (which
// drives the chip + the default tag audience) was fetched once via GET /tags
// and never refreshed — so after un-sharing in-session the chip still claimed
// the comment would reach both teams. (The server clamps on submit, so the
// stored tag was actually personal; the bug was the misleading preview.)
test('scope chip reflects shares un-toggled in the same session', async ({ page }) => {
  const { userId } = await signInAsTestUser(page, { name: 'ScopeOwner', email: 'scope@example.com' });
  const { slug: teamA } = await createTeam(page, 'Team Alpha');
  const { slug: teamB } = await createTeam(page, 'Team Bravo');

  // Upload via page.request so the replay is owned by the signed-in user
  // (replay.userId === session user → isOwner is true in the browser, so the
  // ShareWithTeam controls render).
  const { slug } = await uploadReplay(page.request, {
    local: { username: 'ScopeOwner' },
    opponent: { username: 'Opp' },
  });
  for (const teamSlug of [teamA, teamB]) {
    const res = await page.request.post(`/api/replays/${slug}/team-shares`, { data: { teamSlug } });
    expect(res.ok(), `share with ${teamSlug} failed: ${res.status()}`).toBe(true);
  }

  await page.goto(`/r/${slug}`);

  // Baseline: open the tag form — the chip shows because the replay is shared
  // with two of my teams. B149: an untagged replay opens on the Game log tab,
  // so switch to Review to reach the form.
  await page.getByRole('button', { name: /^Review/ }).click();
  await page.getByRole('button', { name: '+ Tag this frame' }).click();
  await expect(page.getByTestId('scope-chip')).toBeVisible();

  // Un-share both teams via the Share popover, with the tag form still open.
  await page.getByRole('button', { name: 'Share replay' }).click();
  await page.getByRole('checkbox', { name: 'Team Alpha' }).uncheck();
  await page.getByRole('checkbox', { name: 'Team Bravo' }).uncheck();

  // The chip must disappear live — nothing left to scope to, so a new tag
  // defaults to personal.
  await expect(page.getByTestId('scope-chip')).toHaveCount(0);

  expect(userId).toBeTruthy();
});
