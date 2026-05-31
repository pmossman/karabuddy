import { test, expect } from '@playwright/test';
import { uploadReplay } from './helpers';

// Anonymous browsing flows — no sign-in. Covers:
// - Direct slug access (anyone with the link)
// - /teams redirects/prompts for sign-in (account-gated)
// (B85 removed the public replay browser.)

test('anonymous can view a replay by direct URL', async ({ page, request }) => {
  const { slug } = await uploadReplay(request, {
    local: { username: 'OwnerA' },
    opponent: { username: 'OppB' },
    match: { gameFormat: 'premier', gamesToWinMode: 'bestOfOne' },
  });
  await page.goto(`/r/${slug}`);
  // The viewer's sidebar uses MatchupRow that exposes the player's
  // username; check both are visible somewhere on the page. Both names
  // now appear twice (default title "OwnerA vs OppB" + MatchupRow
  // username), so .first() is enough — we just want presence.
  await expect(page.getByText('OwnerA').first()).toBeVisible();
  await expect(page.getByText('OppB').first()).toBeVisible();
});

test('/teams shows a sign-in prompt for anonymous users', async ({ page }) => {
  await page.goto('/teams');
  await expect(page.getByText(/Sign in to create or join a team/i)).toBeVisible();
});

