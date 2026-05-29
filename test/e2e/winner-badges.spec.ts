import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B59: server extracts winner from the final gamestate at upload, stores
// it on the row, and the UI renders green W / red L pills next to each
// player's username in the viewer + browser teasers + table cell.

test('upload extracts winner from final gamestate; GET /api/replays/[slug] returns it', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'WinExtract', email: 'we@example.com' });
  const localId = 'we-l-' + Math.random().toString(36).slice(2, 8);
  const oppId = 'we-o-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'WinExtract' },
    opponent: { id: oppId, username: 'OppP' },
    winners: [localId],
  });
  const res = await request.get(`/api/replays/${r.slug}`);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.data.winners).toEqual([localId]);
});

test('viewer header shows green W next to winning player + red L on the loser', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Wviewer', email: 'wv@example.com' });
  const localId = 'wv-l-' + Math.random().toString(36).slice(2, 8);
  const oppId = 'wv-o-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'Wviewer' },
    opponent: { id: oppId, username: 'Loser' },
    winners: [localId],
  });
  await claimInstallToken(page, r.installToken);

  await page.goto(`/r/${r.slug}`);
  // Winner badge attached to the local player; loser badge on opponent.
  const winnerBadge = page.getByTestId('result-badge-W').first();
  const loserBadge = page.getByTestId('result-badge-L').first();
  await expect(winnerBadge).toBeVisible();
  await expect(loserBadge).toBeVisible();
});

test('replay browser table cell shows W/L badges next to player names', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'WTable', email: 'wt@example.com' });
  const localId = 'wt-l-' + Math.random().toString(36).slice(2, 8);
  const oppId = 'wt-o-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'WTable' },
    opponent: { id: oppId, username: 'OppT' },
    winners: [oppId], // opp wins this one
  });
  await claimInstallToken(page, r.installToken);

  await page.goto('/replays?tab=mine');
  const cell = page.getByTestId('replay-cell').first();
  // The opp won → opp gets W, local gets L. Either badge present in the
  // cell is enough to prove the data made it through serialization.
  await expect(cell.getByTestId('result-badge-W').first()).toBeVisible();
  await expect(cell.getByTestId('result-badge-L').first()).toBeVisible();
});

test('replay with no winner data: no badges rendered', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'NoWin', email: 'nw@example.com' });
  const r = await uploadReplay(request, {
    local: { username: 'NoWin' },
    opponent: { username: 'X' },
    // omit `winners` — pre-game-end snapshot / disconnect / abandon
  });
  await claimInstallToken(page, r.installToken);
  await page.goto(`/r/${r.slug}`);
  await expect(page.getByTestId('result-badge-W')).toHaveCount(0);
  await expect(page.getByTestId('result-badge-L')).toHaveCount(0);
});
