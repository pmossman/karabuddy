import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B129: replays sharing a match.lobbyId form a Bo3 series. B216: the viewer's
// Matchup panel (?panel=info) shows "Game N" in the auto title + a SERIES
// section — one summary row per game, siblings as links (testid series-game-N),
// the current game highlighted with aria-current="page". Identity-entitled
// viewers only. The browser's series groups label each game with a Game-N chip.

test('series: Matchup panel shows Game-N title + per-game rows; browser chips each game', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'SeriesGuy', email: 'series@example.com' });
  const lobbyId = 'lobby-' + randomUUID();

  // Claim BEFORE upload so both games attribute to the account (the series
  // rows are entitlement-gated on identity access).
  const token = `kbx_${randomUUID()}`;
  await claimInstallToken(page, token);
  const g1 = await uploadReplay(request, {
    installToken: token,
    local: { username: 'SeriesGuy' },
    opponent: { username: 'Rival' },
    match: { gamesToWinMode: 'bestOfThree', lobbyId },
  });
  const g2 = await uploadReplay(request, {
    installToken: token,
    local: { username: 'SeriesGuy' },
    opponent: { username: 'Rival' },
    match: { gamesToWinMode: 'bestOfThree', lobbyId },
  });

  // Game 1: open the Matchup panel via deep-link. The auto title carries the
  // game number; the SERIES section shows the current game as a highlighted
  // row and the sibling as a link.
  await page.goto(`/r/${g1.slug}?panel=info`);
  await expect(page.getByText(/— Game 1/).first()).toBeVisible();
  await expect(page.getByRole('complementary').locator('[aria-current="page"]')).toContainText('Game 1');
  await expect(page.getByTestId('series-game-2')).toBeVisible();

  // Hop to game 2 — the sibling row links with ?panel=info, so the Matchup
  // view survives the jump and the current/link roles flip.
  await page.getByTestId('series-game-2').click();
  await page.waitForURL(new RegExp(`/r/${g2.slug}`));
  // Scope into the panel — Next's route announcer echoes the page title (which
  // contains "— Game 2") page-wide, so an unscoped getByText can pass vacuously.
  await expect(page.getByRole('complementary').getByText(/— Game 2/).first()).toBeVisible();
  await expect(page.getByRole('complementary').locator('[aria-current="page"]')).toContainText('Game 2');
  await expect(page.getByTestId('series-game-1')).toBeVisible();

  // The replay browser labels each game inside the series group.
  await page.goto('/replays?tab=mine');
  await expect(page.getByTestId('series-group')).toHaveCount(1);
  await expect(page.getByTestId('game-number-chip')).toHaveCount(2);
});

test('B158: series rows scope to the viewer\'s own side (opponent rows excluded)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Mine', email: 'mine-series@example.com' });
  const lobbyId = 'lobby-' + randomUUID();
  const myToken = `kbx_${randomUUID()}`;
  await claimInstallToken(page, myToken);
  const g1 = await uploadReplay(request, { installToken: myToken, local: { username: 'Mine' }, opponent: { username: 'Opp' }, match: { gamesToWinMode: 'bestOfThree', lobbyId } });
  await uploadReplay(request, { installToken: myToken, local: { username: 'Mine' }, opponent: { username: 'Opp' }, match: { gamesToWinMode: 'bestOfThree', lobbyId } });
  // The opponent records their OWN game in the SAME karabast lobby (B158 p2 — a
  // separate row owned by them). It must NOT appear in my series rows.
  const oppToken = `kbx_${randomUUID()}`;
  await uploadReplay(request, { installToken: oppToken, local: { username: 'Opp' }, opponent: { username: 'Mine' }, match: { gamesToWinMode: 'bestOfThree', lobbyId } });

  await page.goto(`/r/${g1.slug}?panel=info`);
  await expect(page.getByRole('complementary').locator('[aria-current="page"]')).toContainText('Game 1');
  await expect(page.getByTestId('series-game-2')).toBeVisible();
  await expect(page.getByTestId('series-game-3')).toHaveCount(0); // opponent's row not a sibling
});

test('series rows are hidden from a viewer without identity access', async ({ page, browser, request }) => {
  await signInAsTestUser(page, { name: 'SeriesOwner', email: 'series-owner@example.com' });
  const lobbyId = 'lobby-' + randomUUID();
  const token = `kbx_${randomUUID()}`;
  await claimInstallToken(page, token);
  const g1 = await uploadReplay(request, {
    installToken: token,
    local: { username: 'SeriesOwner' },
    opponent: { username: 'Rival' },
    match: { gamesToWinMode: 'bestOfThree', lobbyId },
  });
  await uploadReplay(request, {
    installToken: token,
    local: { username: 'SeriesOwner' },
    opponent: { username: 'Rival' },
    match: { gamesToWinMode: 'bestOfThree', lobbyId },
  });

  // A stranger with the game-1 link must not be handed the sibling slugs —
  // the server strips the series entirely (no rows, no Game-N title suffix),
  // even with the Matchup panel open.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(`/r/${g1.slug}?panel=info`);
  await expect(page2.getByTestId('board')).toHaveAttribute('data-frames', /^[1-9]\d*$/); // viewer loaded
  await expect(page2.getByText('VS', { exact: true })).toBeVisible(); // Matchup view rendered
  await expect(page2.getByTestId(/^series-game-/)).toHaveCount(0);
  await expect(page2.getByText(/— Game/)).toHaveCount(0);
  await ctx2.close();
});
