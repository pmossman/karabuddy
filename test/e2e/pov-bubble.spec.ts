import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, createTeam, generateInvite, uploadReplay, claimInstallToken } from './helpers';

// B128: double-sided replay controls bubble — manual Flip + the hotseat
// "auto-switch" (fade-to-black handoff that follows the active player).

test('single-sided replay: no perspective bubble', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'SoloViewer' });
  const { slug, installToken } = await uploadReplay(request, {
    local: { username: 'SoloViewer' },
    opponent: { username: 'Opp' },
  });
  await claimInstallToken(page, installToken);
  await page.goto(`/r/${slug}`);
  await expect(page.getByText(/Frame 1/)).toBeVisible(); // viewer loaded
  await expect(page.getByTestId('pov-bubble-fab')).toHaveCount(0);
});

test('double-sided: bubble appears; manual flip + auto-switch handoff work', async ({ page, browser, request }) => {
  // Two teammates: A (canonical recorder) + B (alt recorder).
  await signInAsTestUser(page, { name: 'UserA', email: 'pov-a@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'POV Squad');
  const { code } = await generateInvite(page, teamSlug);

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signInAsTestUser(page2, { name: 'UserB', email: 'pov-b@example.com' });
  await page2.goto(`/teams/join?code=${code}`);
  await page2.waitForURL(new RegExp(`/teams/${teamSlug}`));

  // A records + uploads the game, shared to the team. Claim BEFORE uploading
  // so the share applies (anonymous uploads can't arm team shares) and the
  // replay is account-attributed from the start. A's recording marks the
  // OPPONENT (B's side) as the active player so auto-switch has a reason to flip.
  const gameId = randomUUID();
  const tokenA = `kbx_${randomUUID()}`;
  await claimInstallToken(page, tokenA);
  const { slug } = await uploadReplay(request, {
    gameId,
    installToken: tokenA,
    local: { id: 'pA', username: 'UserA' },
    opponent: { id: 'pB', username: 'UserB' },
    activePlayer: 'opponent',
    shareTeamSlugs: [teamSlug],
  });

  // B uploads the SAME game from their seat (claim BEFORE upload so the alt
  // branch attributes it to B's account). B's recording marks B (local) active.
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

  // A opens the replay: the double-sided bubble exists, showing A's POV.
  await page.goto(`/r/${slug}`);
  await expect(page.getByTestId('pov-bubble-fab')).toBeVisible();
  await page.getByTestId('pov-bubble-fab').click();
  const panel = page.getByTestId('pov-bubble-panel');
  await expect(panel).toContainText('Viewing UserA');

  // Manual flip → the other recording's POV.
  await panel.getByRole('button', { name: /Flip/ }).click();
  await expect(panel).toContainText('Viewing UserB');
  await panel.getByRole('button', { name: /Flip/ }).click();
  await expect(panel).toContainText('Viewing UserA');

  // Auto-switch: A's recording says it's B's turn → fade-to-black handoff to
  // B's recording, then the curtain lifts.
  await panel.getByRole('checkbox', { name: /Auto-switch/ }).click();
  await expect(page.getByTestId('pov-curtain')).toBeVisible();
  await expect(panel).toContainText('Viewing UserB', { timeout: 5000 });
  await expect(page.getByTestId('pov-curtain')).toHaveCSS('opacity', '0', { timeout: 5000 });
});
