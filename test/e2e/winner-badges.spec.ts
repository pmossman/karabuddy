import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B59: server extracts winner from the final gamestate at upload, stores
// it on the row, and the UI renders green W / red L pills next to each
// player's username in the viewer + browser teasers + table cell.

test('extractor resolves winner-by-username to playerId (matches karabast shape)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'WinByName', email: 'wbn@example.com' });
  const localId = 'wbn-l-' + Math.random().toString(36).slice(2, 8);
  const oppId = 'wbn-o-' + Math.random().toString(36).slice(2, 8);
  // Karabast's payload puts the WINNER'S USERNAME in `winners`, not the
  // playerId. The extractor must resolve it to the playerId so the
  // ResultBadge (which checks `winners.includes(player.id)`) lights up.
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'WinByName' },
    opponent: { id: oppId, username: 'OppByName' },
    winners: ['WinByName'], // username, not localId
  });
  const res = await request.get(`/api/replays/${r.slug}`);
  const body = await res.json();
  expect(body.data.winners).toEqual([localId]);
});

test('upload extracts winner from a PATCH-delta gamestate (mirrors karabast recorder)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'WinPatch', email: 'wp@example.com' });
  const localId = 'wp-l-' + Math.random().toString(36).slice(2, 8);
  const oppId = 'wp-o-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'WinPatch' },
    opponent: { id: oppId, username: 'OppP' },
    winners: [localId],
    winnersViaPatch: true,
  });
  const res = await request.get(`/api/replays/${r.slug}`);
  const body = await res.json();
  expect(body.ok).toBe(true);
  // The patch event set winners after the full snapshot. Extractor
  // must reconstruct via applyPatch + read from the final state.
  expect(body.data.winners).toEqual([localId]);
});

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

test('viewer Matchup panel shows green W next to winning player + red L on the loser', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Wviewer', email: 'wv@example.com' });
  const localId = 'wv-l-' + Math.random().toString(36).slice(2, 8);
  const oppId = 'wv-o-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'Wviewer' },
    opponent: { id: oppId, username: 'Loser' },
    winners: [localId],
  });
  await claimInstallToken(page, r.installToken);

  // B216: the badges render next to the player names in the Matchup view
  // (?panel=info) — the old always-on viewer header is gone.
  await page.goto(`/r/${r.slug}?panel=info`);
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

// Result filter on /replays?tab=mine — "Wins" / "Losses" / "Any".
test('result filter: Wins shows only replays the owner won', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'WinFilter', email: 'wf@example.com' });
  const localA = 'wf-l-' + Math.random().toString(36).slice(2, 8);
  const oppA = 'wf-o-' + Math.random().toString(36).slice(2, 8);
  const winReplay = await uploadReplay(request, {
    local: { id: localA, username: 'WinFilter' },
    opponent: { id: oppA, username: 'OppWin' },
    winners: [localA],
  });
  await claimInstallToken(page, winReplay.installToken);

  const localB = 'wf-l2-' + Math.random().toString(36).slice(2, 8);
  const oppB = 'wf-o2-' + Math.random().toString(36).slice(2, 8);
  const lossReplay = await uploadReplay(request, {
    local: { id: localB, username: 'WinFilter' },
    opponent: { id: oppB, username: 'OppLoss' },
    winners: [oppB],
  });
  await claimInstallToken(page, lossReplay.installToken);

  await page.goto('/replays?tab=mine');
  // Both rows present initially.
  await expect(page.getByRole('link', { name: /WinFilter vs OppWin/ })).toHaveCount(1);
  await expect(page.getByRole('link', { name: /WinFilter vs OppLoss/ })).toHaveCount(1);

  await page.getByRole('button', { name: 'Filters' }).click(); // filters collapsed by default
  await page.getByLabel('Result').selectOption('wins');
  await expect.poll(() => new URL(page.url()).searchParams.get('result')).toBe('wins');
  await expect(page.getByRole('link', { name: /WinFilter vs OppWin/ })).toHaveCount(1);
  await expect(page.getByRole('link', { name: /WinFilter vs OppLoss/ })).toHaveCount(0);

  // Flip to Losses → opposite set.
  await page.getByLabel('Result').selectOption('losses');
  await expect(page.getByRole('link', { name: /WinFilter vs OppWin/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /WinFilter vs OppLoss/ })).toHaveCount(1);
});

test('result filter: replays without winner data are hidden when filter is on', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'NoData', email: 'nd@example.com' });
  // One replay with winner, one without.
  const localId = 'nd-l-' + Math.random().toString(36).slice(2, 8);
  const oppId = 'nd-o-' + Math.random().toString(36).slice(2, 8);
  const withWin = await uploadReplay(request, {
    local: { id: localId, username: 'NoData' },
    opponent: { id: oppId, username: 'OppKnown' },
    winners: [localId],
  });
  await claimInstallToken(page, withWin.installToken);

  const noWin = await uploadReplay(request, {
    local: { username: 'NoData' },
    opponent: { username: 'OppUnknown' },
    // no winners array — game ended via disconnect / abandon
  });
  await claimInstallToken(page, noWin.installToken);

  await page.goto('/replays?tab=mine&result=wins');
  await expect(page.getByRole('link', { name: /NoData vs OppKnown/ })).toHaveCount(1);
  await expect(page.getByRole('link', { name: /NoData vs OppUnknown/ })).toHaveCount(0);
});

test('owner is rendered first even when jsonb sorts their playerId last', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'OrderFix', email: 'of@example.com' });
  // Pick IDs where the OWNER's id sorts AFTER the opponent's by jsonb
  // rules (jsonb normalizes by length then lex). Same length → lex
  // order; 'z...' > 'a...' so opp comes first in the raw column.
  const localId = 'zzzz-' + Math.random().toString(36).slice(2, 8);
  const oppId = 'aaaa-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'OrderFix' },
    opponent: { id: oppId, username: 'OppBefore' },
  });
  await claimInstallToken(page, r.installToken);

  await page.goto('/replays?tab=mine');
  // The matchup text should be "OrderFix vs OppBefore" — owner first.
  const cell = page.getByTestId('replay-cell').first();
  await expect(cell.getByRole('link')).toContainText(/OrderFix vs OppBefore/);
});

test('replay with no winner data: no badges rendered', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'NoWin', email: 'nw@example.com' });
  const r = await uploadReplay(request, {
    local: { username: 'NoWin' },
    opponent: { username: 'X' },
    // omit `winners` — pre-game-end snapshot / disconnect / abandon
  });
  await claimInstallToken(page, r.installToken);
  // B216: badges live in the Matchup view — open it so the absence assertion
  // is meaningful (with the panel closed there'd be no badge anywhere anyway).
  await page.goto(`/r/${r.slug}?panel=info`);
  await expect(page.getByText('VS', { exact: true })).toBeVisible(); // matchup rendered
  await expect(page.getByTestId('result-badge-W')).toHaveCount(0);
  await expect(page.getByTestId('result-badge-L')).toHaveCount(0);
});
