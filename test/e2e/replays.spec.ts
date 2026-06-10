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

  await page.goto(`/r/${slug}`);
  await expect(page.getByText('Tournament Game 3')).toBeVisible();
  // Label chip appears in the sidebar header; use .first() since the
  // viewer also renders the label-text potentially in EditReplayMeta's
  // input default value (it's a button that says "Edit title + labels"
  // so no input is rendered until clicked, but we play it safe).
  await expect(page.getByText('tournament').first()).toBeVisible();
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

  await page.goto(`/r/${slug}`);
  await expect(page.getByText('first tag')).toBeVisible();

  const editRes = await page.request.patch(`/api/replays/${slug}/tags/${tagId}`, {
    data: { comment: 'edited tag' },
    headers: { 'X-Install-Token': installToken },
  });
  expect(editRes.ok()).toBe(true);
  await page.reload();
  await expect(page.getByText('edited tag')).toBeVisible();
  await expect(page.getByText('first tag')).not.toBeVisible();

  const delRes = await page.request.delete(`/api/replays/${slug}/tags/${tagId}`, {
    headers: { 'X-Install-Token': installToken },
  });
  expect(delRes.ok()).toBe(true);
  await page.reload();
  await expect(page.getByText('edited tag')).not.toBeVisible();
});

test('frame deeplink: ?f=N lands on that frame', async ({ page, request }) => {
  const { slug } = await uploadReplay(request, {
    local: { username: 'P1' },
    opponent: { username: 'P2' },
  });
  await page.goto(`/r/${slug}?f=1`);
  await expect(page.getByText(/Frame 1 \/ 1/)).toBeVisible();
});
