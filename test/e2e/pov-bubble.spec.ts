import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, createTeam, generateInvite, uploadReplay, claimInstallToken } from './helpers';

// B128 v2: double-sided replays show BOTH hands face up (the other recording's
// unmasked hand + resources merged into the board) — no auto board flipping.
// B216: the controls live in a glass capsule on the rail, next to the
// Play FAB — the hands-up toggle (default ON) + the manual Flip.

test('single-sided replay: no double-sided controls', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'SoloViewer' });
  const { slug, installToken } = await uploadReplay(request, {
    local: { username: 'SoloViewer' },
    opponent: { username: 'Opp' },
  });
  await claimInstallToken(page, installToken);
  await page.goto(`/r/${slug}`);
  // Chrome mounted + payload decoded (the board sentinel reports frame count).
  await expect(page.getByRole('button', { name: 'Sidebar' })).toBeVisible();
  await expect(page.getByTestId('board')).toHaveAttribute('data-frames', /^[1-9]\d*$/);
  await expect(page.getByTestId('pov-controls')).toHaveCount(0);

  // …and no "both POVs" badge in the browser.
  await page.goto('/replays');
  await expect(page.getByTestId('replay-cell').first()).toBeVisible();
  await expect(page.getByTestId('double-sided-chip')).toHaveCount(0);
});

test('double-sided: hands-up on by default, reveals the hidden hand; manual flip works', async ({ page, browser, request }) => {
  // Two teammates: A (canonical recorder) + B (alt recorder).
  await signInAsTestUser(page, { name: 'UserA', email: 'pov-a@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'POV Squad');
  const { code } = await generateInvite(page, teamSlug);

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signInAsTestUser(page2, { name: 'UserB', email: 'pov-b@example.com' });
  await page2.goto(`/teams/join?code=${code}`);
  await page2.waitForURL(new RegExp(`/teams/${teamSlug}`));

  // A records + uploads, shared to the team (claim BEFORE upload so the share
  // + account attribution apply). B uploads the SAME game from their seat.
  const gameId = randomUUID();
  const tokenA = `kbx_${randomUUID()}`;
  await claimInstallToken(page, tokenA);
  const { slug } = await uploadReplay(request, {
    gameId,
    installToken: tokenA,
    local: { id: 'pA', username: 'UserA' },
    opponent: { id: 'pB', username: 'UserB' },
    shareTeamSlugs: [teamSlug],
  });
  const tokenB = `kbx_${randomUUID()}`;
  await claimInstallToken(page2, tokenB);
  await uploadReplay(request, {
    gameId,
    installToken: tokenB,
    local: { id: 'pB', username: 'UserB' },
    opponent: { id: 'pA', username: 'UserA' },
    shareTeamSlugs: [teamSlug],
  });
  await ctx2.close();

  await page.goto(`/r/${slug}`);
  // The labelled glass group next to the Play FAB (double-sided replays only).
  const controls = page.getByTestId('pov-controls');
  await expect(controls).toBeVisible();
  // The pair is a capsule in the rail (no text label — the grouping IS the cue).

  // Hands-up defaults ON; B's hand card (visible only in B's own recording)
  // appears on A's board once the alt payload lands + merges. The fixture's
  // hidden opponent hand is empty, so the revealed card is the proof (the
  // reveal-toggle button exposes no aria-pressed — the board effect IS the
  // assertion).
  await expect(page.locator('[data-card-uuid="card-1"]')).toHaveCount(2, { timeout: 5000 }); // own + revealed

  // Toggle off → the revealed card disappears again.
  await page.getByTestId('reveal-toggle').click();
  await expect(page.locator('[data-card-uuid="card-1"]')).toHaveCount(1);

  // Manual flip → snappy curtain, lands in B's seat (flip button label tracks
  // whose recording is shown).
  await expect(page.getByTestId('flip-button')).toHaveAttribute('title', /viewing UserA/);
  await page.getByTestId('flip-button').click();
  await expect(page.getByTestId('flip-button')).toHaveAttribute('title', /viewing UserB/, { timeout: 5000 });
  await expect(page.getByTestId('pov-curtain')).toHaveCSS('opacity', '0', { timeout: 5000 });

  // B128: the replay browser tags it — "⇄ both POVs" chip in the table (personal
  // library) and on the team grid.
  await page.goto('/replays');
  await expect(page.getByTestId('double-sided-chip').first()).toBeVisible();
  await page.goto(`/teams/${teamSlug}?tab=replays`);
  await expect(page.getByTestId('double-sided-chip').first()).toBeVisible();
});
