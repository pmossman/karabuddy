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

  // Publish via the owner's session (the Share popover drives this PATCH).
  const res = await page.request.patch(`/api/replays/${slug}`, { data: { public: true } });
  expect(res.ok()).toBeTruthy();

  // The owner's library shows the Public badge.
  await page.goto('/replays?tab=mine');
  await expect(page.getByTestId('public-badge').first()).toBeVisible();

  // A signed-out visitor: viewer shows the comment, redacted + aliased.
  const ctx2 = await browser.newContext();
  const anon = await ctx2.newPage();
  await anon.goto(`/r/${slug}`);
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
  await expect(anon3.getByText(/Frame 1/)).toBeVisible(); // viewer loaded
  await expect(anon3.getByText(/great line, ask/)).toHaveCount(0);
  await ctx3.close();
});

// B132: jump to the previous/next annotated frame from the board edges.
test('tag-jump buttons step between annotated frames', async ({ page, request }) => {
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
  await expect(page.getByText(/Frame 1 \/ 4/)).toBeVisible();
  await expect(page.getByTestId('tag-jump-prev')).toBeDisabled(); // nothing behind frame 1
  await expect(page.getByTestId('tag-jump-next')).toBeEnabled();

  // First jump lands on the first annotated frame — the comment surfaces in
  // the "This frame" callout.
  await page.getByTestId('tag-jump-next').click();
  await expect(page.getByText('pivotal moment here')).toBeVisible();
  await expect(page.getByText('This frame', { exact: true })).toBeVisible();
  await expect(page.getByTestId('tag-jump-prev')).toBeDisabled(); // no tags behind
  await expect(page.getByTestId('tag-jump-next')).toBeEnabled();  // one more ahead

  // Second jump → the last annotated frame; nothing further ahead, one behind.
  await page.getByTestId('tag-jump-next').click();
  await expect(page.getByText('the closer')).toBeVisible();
  await expect(page.getByTestId('tag-jump-next')).toBeDisabled();
  await expect(page.getByTestId('tag-jump-prev')).toBeEnabled();
});
