import { test, expect } from '@playwright/test';
import { uploadReplay } from './helpers';

// Anonymous browsing flows — no sign-in. Covers:
// - Public replay browser (anonymous can see toggled-public replays)
// - Direct unlisted slug access (anyone with the link)
// - /teams redirects/prompts for sign-in (account-gated)

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

test('public replay browser shows uploaded-public replays', async ({ page, request }) => {
  // Upload one + flip to public via PATCH using the install token.
  const { slug, installToken } = await uploadReplay(request, {
    local: { username: 'PubOwner' },
    opponent: { username: 'PubOpp' },
  });
  const patchRes = await request.patch(`/api/replays/${slug}`, {
    data: { visibility: 'public' },
    headers: { 'X-Install-Token': installToken },
  });
  expect(patchRes.ok()).toBe(true);

  await page.goto('/replays?tab=public');
  await expect(page.getByRole('heading', { name: 'Replays', level: 1 })).toBeVisible();
  // The public replay's matchup text should appear on the page.
  await expect(page.getByText(/PubOwner.*vs.*PubOpp|PubOpp.*vs.*PubOwner/)).toBeVisible({ timeout: 5000 });
});
