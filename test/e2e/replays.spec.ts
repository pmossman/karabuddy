import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

test('signed-in owner can view their replay on /replays?tab=mine', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Mine Owner' });
  const { installToken } = await uploadReplay(request, {
    local: { username: 'MineOwner' },
    opponent: { username: 'OtherP' },
  });
  await claimInstallToken(page, installToken);

  await page.goto('/replays?tab=mine');
  await expect(page.getByText(/MineOwner.*vs.*OtherP|OtherP.*vs.*MineOwner/)).toBeVisible({ timeout: 5000 });
});

test('owner can rename their replay + add labels', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Editor' });
  const { slug, installToken } = await uploadReplay(request, {
    local: { username: 'Editor' },
    opponent: { username: 'Other' },
  });
  await claimInstallToken(page, installToken); // B122: claimed owner sees real identities
  const patchRes = await page.request.patch(`/api/replays/${slug}`, {
    data: { displayName: 'Tournament Game 3', labels: ['tournament', 'meta-tier'] },
    headers: { 'X-Install-Token': installToken },
  });
  expect(patchRes.ok()).toBe(true);

  // B216: the title + labels moved into the panel's Matchup view — deep-link
  // it open with ?panel=info.
  await page.goto(`/r/${slug}?panel=info`);
  await expect(page.getByTestId('board')).toHaveAttribute('data-frames', '1');
  await expect(page.getByText('Tournament Game 3')).toBeVisible();
  // Label pill (testid'd — plain getByText('tournament') would also match
  // "Tournament Game 3" case-insensitively).
  await expect(page.getByTestId('label-pill').filter({ hasText: 'tournament' })).toBeVisible();
});

test('tag CRUD: add, edit, delete', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Tagger' });
  const { slug, installToken } = await uploadReplay(request, {
    local: { username: 'Tagger' },
    opponent: { username: 'Other' },
  });
  await claimInstallToken(page, installToken); // B122: claimed owner sees real identities + their tags
  const addRes = await page.request.post(`/api/replays/${slug}/tags`, {
    data: { installToken, authorName: 'Tagger', frameIndex: 0, comment: 'first tag' },
  });
  const { id: tagId } = await addRes.json();
  expect(addRes.ok()).toBe(true);

  // B216: tags render in the panel's Tags feed (?panel=tags). The chrome
  // strips the panel param after opening, so re-navigate (not reload) between
  // steps.
  await page.goto(`/r/${slug}?panel=tags`);
  await expect(page.getByTestId('board')).toHaveAttribute('data-frames', '1');
  await expect(page.getByText('first tag')).toBeVisible();

  const editRes = await page.request.patch(`/api/replays/${slug}/tags/${tagId}`, {
    data: { comment: 'edited tag' },
    headers: { 'X-Install-Token': installToken },
  });
  expect(editRes.ok()).toBe(true);
  await page.goto(`/r/${slug}?panel=tags`);
  await expect(page.getByText('edited tag')).toBeVisible();
  await expect(page.getByText('first tag')).not.toBeVisible();

  const delRes = await page.request.delete(`/api/replays/${slug}/tags/${tagId}`, {
    headers: { 'X-Install-Token': installToken },
  });
  expect(delRes.ok()).toBe(true);
  await page.goto(`/r/${slug}?panel=tags`);
  await expect(page.getByText('No tags on this replay yet.')).toBeVisible();
  await expect(page.getByText('edited tag')).not.toBeVisible();
});

test('frame deeplink: ?f=N lands on that frame', async ({ page, request }) => {
  // Two distinct board positions so landing on frame 2 is observable.
  const { slug } = await uploadReplay(request, {
    local: { username: 'P1' },
    opponent: { username: 'P2' },
    extraGamestatePatches: [{ phase: 'B' }],
  });
  await page.goto(`/r/${slug}?f=2`);
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-frames', '2');
  await expect(board).toHaveAttribute('data-frame', '2');
});
