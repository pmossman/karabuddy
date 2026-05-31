import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, uploadReplay, claimInstallToken } from './helpers';

// Team-share + filter UI. (B85 removed public replays — no public list.)

test('explicit team-share surfaces a replay in the team grid', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'ShareOwner', email: 'so@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Share Team');
  const { slug: replaySlug, installToken } = await uploadReplay(request, {
    local: { username: 'ShareOwner' },
    opponent: { username: 'X' },
  });
  await claimInstallToken(page, installToken);

  // Explicit share via API (matches what the ShareWithTeam UI does).
  const shareRes = await page.request.post(`/api/replays/${replaySlug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': installToken },
  });
  expect(shareRes.ok()).toBe(true);

  await page.goto(`/teams/${teamSlug}?tab=replays`);
  await expect(page.getByText(/ShareOwner.*vs.*X|X.*vs.*ShareOwner/).first()).toBeVisible({ timeout: 5000 });
});

test('replay filters narrow the grid by label', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'FilterTester', email: 'ft@example.com' });

  const r1 = await uploadReplay(request, {
    local: { username: 'FilterTester' },
    opponent: { username: 'A' },
  });
  await claimInstallToken(page, r1.installToken);
  await page.request.patch(`/api/replays/${r1.slug}`, {
    data: { labels: ['tournament'] },
    headers: { 'X-Install-Token': r1.installToken },
  });

  const r2 = await uploadReplay(request, {
    local: { username: 'FilterTester' },
    opponent: { username: 'B' },
  });
  await claimInstallToken(page, r2.installToken);

  await page.goto('/replays?tab=mine');
  // Each card renders as an <a>; match by accessible name (which
  // contains "FilterTester vs A" / "FilterTester vs B") so the count
  // assertions track real cards, not arbitrary ancestor text.
  const cardA = page.getByRole('link', { name: /FilterTester vs A/ });
  const cardB = page.getByRole('link', { name: /FilterTester vs B/ });
  await expect(cardA).toHaveCount(1, { timeout: 5000 });
  await expect(cardB).toHaveCount(1);

  // Filter by label → only the tournament-labeled card remains.
  await page.getByRole('button', { name: 'Filters' }).click(); // filters collapsed by default
  await page.getByLabel('Label').selectOption('tournament');
  await expect(cardA).toHaveCount(1);
  await expect(cardB).toHaveCount(0);
});
