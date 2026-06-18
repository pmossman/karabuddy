import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, uploadReplay, claimInstallToken } from './helpers';

// Regression guard for the reported team-centric bug: pick Team A from the
// switcher, open one of its replays, then the sidebar/hamburger snapped back to
// your FIRST-JOINED team. Cause: entering the immersive viewer remounts the
// sidebar (overlay tree vs column tree), which re-seeded active team from the
// (app) layout's frozen server prop (your default team) instead of the team you
// had navigated to. Active team now lives in a layout-level provider that
// survives the remount. (A replay is just content — viewing one never SWITCHES
// your team; this checks the team you picked STAYS picked.)
test('viewer: the team you picked stays active after opening its replay', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsTestUser(page, { name: 'StickyTeam' });
  // 'Bee' first → your default / first-joined team (the one the bug snapped to).
  const { slug: beeSlug } = await createTeam(page, 'Bee Team');
  const { slug: ayeSlug } = await createTeam(page, 'Aye Team');

  const { slug: rSlug, installToken } = await uploadReplay(page.request, {
    local: { username: 'me', leaderName: 'Luke Skywalker' },
    opponent: { username: 'opp', leaderName: 'Darth Vader' },
    shareTeamSlugs: [ayeSlug],
  });
  await claimInstallToken(page, installToken);

  // Hard-load a page so the layout's server `active` prop is seeded as the
  // default (Bee) — the frozen value the bug fell back to.
  await page.goto(`/teams/${beeSlug}`);

  // Pick Team A (Aye) from the switcher — a client-side soft nav, so the layout
  // (and its `active` prop) does NOT re-render; only the provider state moves.
  await page.getByRole('button', { name: 'Switch team' }).click();
  await page.getByRole('menuitemradio', { name: 'Aye Team' }).click();
  await page.waitForURL(`**/teams/${ayeSlug}`);

  // Open the Aye replay via an in-app link (soft nav into the viewer → the
  // sidebar remounts as the overlay variant).
  const replayLink = page.locator(`a[href="/r/${rSlug}"]`).first();
  await replayLink.waitFor();
  await replayLink.click();
  await page.waitForURL(`**/r/${rSlug}`);

  // The hamburger/switcher must still show the team you picked, not your default.
  await page.getByRole('button', { name: 'Menu' }).click();
  const switcher = page.getByRole('button', { name: 'Switch team' });
  await expect(switcher).toContainText('Aye Team');
  await expect(switcher).not.toContainText('Bee Team');
});
