import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B133: owner-controlled public replays — published games (and their vetted
// comments, redacted) are visible to anyone; the public browser + signed-out
// home surface them.

test('publish → signed-out visitors see redacted comments, the public tab, and the home showcase', async ({ page, browser, request }) => {
  await signInAsTestUser(page, { name: 'PubOwner', email: 'pub-owner@example.com' });
  const token = `kbx_${randomUUID()}`;
  await claimInstallToken(page, token);
  const { slug } = await uploadReplay(request, {
    installToken: token,
    local: { username: 'PubOwner' },
    opponent: { username: 'PubRival' },
  });
  // An anonymous friend's comment with a free-typed mention — via the
  // cookie-less request fixture (page.request would ride the owner's session
  // and the route would attribute the tag to the account name).
  await request.post(`/api/replays/${slug}/tags`, {
    data: { installToken: `kb_${randomUUID()}`, authorName: 'SecretFriend', frameIndex: 0, comment: 'great line, ask @luke too' },
  });

  // Publish via the owner's session (the Share view drives this PATCH).
  const res = await page.request.patch(`/api/replays/${slug}`, { data: { public: true } });
  expect(res.ok()).toBeTruthy();

  // The owner's library shows the Public badge.
  await page.goto('/replays?tab=mine');
  await expect(page.getByTestId('public-badge').first()).toBeVisible();

  // A signed-out visitor: the Tag HUD (rail "Tags") shows the comment,
  // redacted + aliased.
  const ctx2 = await browser.newContext();
  const anon = await ctx2.newPage();
  await anon.goto(`/r/${slug}`);
  await expect(anon.getByTestId('board')).toHaveAttribute('data-frames', '1');
  await anon.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(anon.getByText(/great line, ask/)).toBeVisible();
  await expect(anon.getByText('@[redacted]').first()).toBeVisible();
  await expect(anon.getByText('Reviewer 1').first()).toBeVisible();
  await expect(anon.getByText('SecretFriend')).toHaveCount(0);

  // Public tab, signed out: the replay is listed, players anonymized.
  await anon.goto('/replays?tab=public');
  await expect(anon.getByTestId('replay-cell').first()).toBeVisible();
  await expect(anon.getByText(/Player1 vs Player2/).first()).toBeVisible();
  await expect(anon.getByText('PubOwner')).toHaveCount(0);

  // Signed-out home: the showcase leads with the public replay.
  await anon.goto('/');
  await expect(anon.getByText('Browse all public replays')).toBeVisible();
  await expect(anon.locator(`a[href="/r/${slug}"]`).first()).toBeVisible();
  await ctx2.close();

  // Unpublish → comments vanish for a fresh anonymous context.
  await page.request.patch(`/api/replays/${slug}`, { data: { public: false } });
  const ctx3 = await browser.newContext();
  const anon3 = await ctx3.newPage();
  await anon3.goto(`/r/${slug}`);
  await expect(anon3.getByTestId('board')).toHaveAttribute('data-frames', '1'); // viewer loaded
  await anon3.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(anon3.getByText('No tags on this frame')).toBeVisible();
  await expect(anon3.getByText(/great line, ask/)).toHaveCount(0);
  await ctx3.close();
});

// B132 → B216: stepping between annotated frames moved from the board-edge
// tag-jump chevrons (removed on purpose) to the Tag HUD's « / » side "ears"
// (plus the [ / ] keyboard shortcuts).
test('tag HUD ears step between annotated frames', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Jumper', email: 'jumper@example.com' });
  const token = `kbx_${randomUUID()}`;
  await claimInstallToken(page, token);
  // 4 distinct board positions (initial + 3 board-changing patches).
  const { slug } = await uploadReplay(request, {
    installToken: token,
    local: { username: 'Jumper' },
    opponent: { username: 'Opp' },
    extraGamestatePatches: [{ phase: 'B' }, { phase: 'C' }, { phase: 'D' }],
  });
  await page.request.post(`/api/replays/${slug}/tags`, {
    data: { installToken: token, authorName: 'Jumper', frameIndex: 1, comment: 'pivotal moment here' },
  });
  await page.request.post(`/api/replays/${slug}/tags`, {
    data: { installToken: token, authorName: 'Jumper', frameIndex: 3, comment: 'the closer' },
  });

  await page.goto(`/r/${slug}`);
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-frames', '4');
  await page.getByRole('button', { name: 'Tags', exact: true }).click(); // open the HUD

  // Frame 1 is untagged: nothing behind, first annotated frame ahead.
  await expect(page.getByText('No tags on this frame')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous tag' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next tag' })).toBeEnabled();

  // First jump lands on the first annotated frame — its comment fills the HUD.
  await page.getByRole('button', { name: 'Next tag' }).click();
  await expect(board).toHaveAttribute('data-frame', '2');
  await expect(page.getByText('pivotal moment here')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous tag' })).toBeDisabled(); // no tags behind
  await expect(page.getByRole('button', { name: 'Next tag' })).toBeEnabled(); // one more ahead

  // Second jump → the last annotated frame; nothing further ahead, one behind.
  await page.getByRole('button', { name: 'Next tag' }).click();
  await expect(board).toHaveAttribute('data-frame', '4');
  await expect(page.getByText('the closer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next tag' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Previous tag' })).toBeEnabled();
});
