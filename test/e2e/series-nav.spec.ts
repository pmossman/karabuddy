import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B129: replays sharing a match.lobbyId form a Bo3 series. The viewer shows
// "Game N" in the auto title + series hop pills (identity-entitled viewers
// only); the browser's series groups label each game with a Game-N chip.

test('series: viewer shows Game-N title + hop pills; browser chips each game', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'SeriesGuy', email: 'series@example.com' });
  const lobbyId = 'lobby-' + randomUUID();

  // Claim BEFORE upload so both games attribute to the account (the series
  // pills are entitlement-gated on identity access).
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

  // Game 1: auto title carries the game number; the nav shows the current
  // game as a pill and the sibling as a link.
  await page.goto(`/r/${g1.slug}`);
  await expect(page.getByTestId('series-nav')).toBeVisible();
  await expect(page.getByText(/— Game 1/).first()).toBeVisible();
  await expect(page.getByTestId('series-game-2')).toBeVisible();

  // Hop to game 2 — the nav survives the jump and flips current/link roles.
  await page.getByTestId('series-game-2').click();
  await page.waitForURL(`**/r/${g2.slug}`);
  await expect(page.getByTestId('series-nav')).toBeVisible();
  await expect(page.getByText(/— Game 2/).first()).toBeVisible();
  await expect(page.getByTestId('series-game-1')).toBeVisible();

  // The replay browser labels each game inside the series group.
  await page.goto('/replays?tab=mine');
  await expect(page.getByTestId('series-group')).toHaveCount(1);
  await expect(page.getByTestId('game-number-chip')).toHaveCount(2);
});

test('B158: series nav scopes to the viewer\'s own side (opponent rows excluded)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Mine', email: 'mine-series@example.com' });
  const lobbyId = 'lobby-' + randomUUID();
  const myToken = `kbx_${randomUUID()}`;
  await claimInstallToken(page, myToken);
  const g1 = await uploadReplay(request, { installToken: myToken, local: { username: 'Mine' }, opponent: { username: 'Opp' }, match: { gamesToWinMode: 'bestOfThree', lobbyId } });
  await uploadReplay(request, { installToken: myToken, local: { username: 'Mine' }, opponent: { username: 'Opp' }, match: { gamesToWinMode: 'bestOfThree', lobbyId } });
  // The opponent records their OWN game in the SAME karabast lobby (B158 p2 — a
  // separate row owned by them). It must NOT appear in my series nav.
  const oppToken = `kbx_${randomUUID()}`;
  await uploadReplay(request, { installToken: oppToken, local: { username: 'Opp' }, opponent: { username: 'Mine' }, match: { gamesToWinMode: 'bestOfThree', lobbyId } });

  await page.goto(`/r/${g1.slug}`);
  await expect(page.getByTestId('series-nav')).toBeVisible();
  await expect(page.getByTestId('series-game-2')).toBeVisible();
  await expect(page.getByTestId('series-game-3')).toHaveCount(0); // opponent's row not a sibling
});

test('series nav is hidden from a viewer without identity access', async ({ page, browser, request }) => {
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

  // A stranger with the game-1 link must not be handed the sibling slugs.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(`/r/${g1.slug}`);
  await expect(page2.getByText(/Frame 1/)).toBeVisible(); // viewer loaded
  await expect(page2.getByTestId('series-nav')).toHaveCount(0);
  await ctx2.close();
});
