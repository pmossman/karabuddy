import { test, expect } from '@playwright/test';
import { uploadReplay } from './helpers';

// Anonymous browsing flows — no sign-in. Covers:
// - Direct slug access (anyone with the link)
// - /teams redirects/prompts for sign-in (account-gated)
// (B85 removed the public replay browser.)

test('anonymous can view a replay by direct URL — but identities are anonymized', async ({ page, request }) => {
  const { slug } = await uploadReplay(request, {
    local: { username: 'OwnerA', leaderName: 'Luke Skywalker' },
    opponent: { username: 'OppB', leaderName: 'Grand Admiral Thrawn' },
    match: { gameFormat: 'premier', gamesToWinMode: 'bestOfOne' },
  });
  await page.goto(`/r/${slug}`);
  // B122: a stranger (no session, no extension) sees the replay but NOT the real
  // karabast handles — players read "Player N". The page must load (anon label
  // present) and the real usernames must appear nowhere.
  await expect(page.getByText(/Player\s*1/).first()).toBeVisible();
  await expect(page.getByText('OwnerA')).toHaveCount(0);
  await expect(page.getByText('OppB')).toHaveCount(0);
});

test('/teams shows a sign-in prompt for anonymous users', async ({ page }) => {
  await page.goto('/teams');
  await expect(page.getByText(/Sign in to create or join a team/i)).toBeVisible();
});

