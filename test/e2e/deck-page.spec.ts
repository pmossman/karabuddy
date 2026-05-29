import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B58: per-replay deck page at /r/[slug]/deck/[playerId]. Renders the
// captured deck snapshot from the replay payload's lobbyState.

function fullDeckSnapshot(localId: string, opponentId: string) {
  return {
    [localId]: {
      username: 'DeckPlayer',
      name: 'Tournament List',
      leader: { id: 'ASH_005', count: 1, cost: null },
      base: { id: 'JTL_024', count: 1, cost: null },
      deck: [
        { id: 'ASH_010', count: 3, cost: 2 },
        { id: 'ASH_011', count: 2, cost: 4 },
        { id: 'JTL_055', count: 3, cost: 1 },
      ],
      sideboard: [
        { id: 'ASH_099', count: 2, cost: 3 },
      ],
    },
    [opponentId]: {
      username: 'Opp',
      name: null,
      leader: { id: 'ASH_014', count: 1, cost: null },
      base: { id: 'JTL_024', count: 1, cost: null },
      deck: null,
      sideboard: null,
    },
  };
}

test('local-player deck page renders leader + base + deck list + sideboard', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'DeckOwner', email: 'do@example.com' });
  // Pre-generate the player IDs so we can key the deck snapshot
  // correctly on the very first upload (avoids upsert dec  k-merge rules).
  const localId = 'local-' + Math.random().toString(36).slice(2, 10);
  const oppId = 'opp-' + Math.random().toString(36).slice(2, 10);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'DeckPlayer' },
    opponent: { id: oppId, username: 'Opp' },
    decks: fullDeckSnapshot(localId, oppId),
  });
  await claimInstallToken(page, r.installToken);

  await page.goto(`/r/${r.slug}/deck/${localId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Header surfaces the deck name and counts.
  await expect(page.getByText(/Tournament List/)).toBeVisible();
  // 8 main + 2 side = 10 total cards listed (3+2+3 main = 8, 2 side).
  await expect(page.getByText(/8 cards/)).toBeVisible();
  // Sideboard renders its own section.
  await expect(page.getByRole('heading', { name: /Sideboard/i })).toBeVisible();
  // "View replay →" link back to the viewer.
  await expect(page.getByRole('link', { name: /View replay/i })).toHaveAttribute('href', `/r/${r.slug}`);
});

test('opponent deck page shows leader+base + the "full list not available" notice', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'OppViewer', email: 'ov@example.com' });
  const localId = 'local-' + Math.random().toString(36).slice(2, 10);
  const oppId = 'opp-' + Math.random().toString(36).slice(2, 10);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'Local' },
    opponent: { id: oppId, username: 'Opp' },
    decks: {
      [localId]: {
        username: 'Local',
        name: null,
        leader: { id: 'ASH_005', count: 1 },
        base: { id: 'JTL_024', count: 1 },
        deck: [{ id: 'ASH_010', count: 3 }],
        sideboard: null,
      },
      [oppId]: {
        username: 'Opp',
        name: null,
        leader: { id: 'ASH_014', count: 1 },
        base: { id: 'JTL_024', count: 1 },
        deck: null,
        sideboard: null,
      },
    },
  });
  await claimInstallToken(page, r.installToken);

  await page.goto(`/r/${r.slug}/deck/${oppId}`);
  await expect(page.getByText(/Full list not available/i)).toBeVisible();
});

test('replay with no deck snapshot at all → friendly empty state', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'NoDeck', email: 'nd@example.com' });
  const r = await uploadReplay(request, {
    local: { username: 'NoDeck' },
    opponent: { username: 'Opp' },
  });
  await claimInstallToken(page, r.installToken);

  // No `decks` passed → null in the DB. The deck page should explain
  // why and link back to the viewer.
  await page.goto(`/r/${r.slug}/deck/${r.localPlayerId}`);
  await expect(page.getByText(/No deck snapshot/i)).toBeVisible();
});

test('unknown slug or unknown playerId → 404', async ({ page }) => {
  const res = await page.goto('/r/r_doesnotexist/deck/anybody');
  expect(res?.status()).toBe(404);
});

// B64: in-viewer decks moved from an in-sidebar disclosure to a large
// modal with per-player tabs.

test('viewer: "View decks" button opens a modal (no in-sidebar disclosure)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'ModalOpener', email: 'mo@example.com' });
  const localId = 'mo-local-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'ModalOpener' },
    opponent: { username: 'Opp' },
    decks: {
      [localId]: {
        username: 'ModalOpener',
        name: 'Main deck',
        leader: { id: 'ASH_005', count: 1 },
        base: { id: 'JTL_024', count: 1 },
        deck: [{ id: 'ASH_010', count: 3 }],
        sideboard: null,
      },
    },
  });
  await claimInstallToken(page, r.installToken);

  await page.goto(`/r/${r.slug}`);
  // No collapsed "Decks ▶" disclosure in the sidebar anymore.
  await expect(page.getByRole('button', { name: /^Decks$/ })).toHaveCount(0);

  // Open the modal.
  await page.getByRole('button', { name: /View decks/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('decks modal: tabs per player; switching tab swaps the displayed deck', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'TabSwitcher', email: 'ts@example.com' });
  const localId = 'ts-local-' + Math.random().toString(36).slice(2, 8);
  const oppId = 'ts-opp-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'TabSwitcher' },
    opponent: { id: oppId, username: 'OppPlayer' },
    decks: {
      [localId]: {
        username: 'TabSwitcher',
        name: 'My list',
        leader: { id: 'ASH_005', count: 1 },
        base: { id: 'JTL_024', count: 1 },
        deck: [{ id: 'ASH_010', count: 3 }],
        sideboard: null,
      },
      [oppId]: {
        username: 'OppPlayer',
        name: null,
        leader: { id: 'ASH_014', count: 1 },
        base: { id: 'JTL_024', count: 1 },
        deck: null,
        sideboard: null,
      },
    },
  });
  await claimInstallToken(page, r.installToken);

  await page.goto(`/r/${r.slug}`);
  await page.getByRole('button', { name: /View decks/i }).click();
  const dialog = page.getByRole('dialog');

  // Default tab is the local player ("You").
  await expect(dialog.getByRole('tab', { name: /TabSwitcher/i, selected: true })).toBeVisible();
  // Opponent tab is present but not selected; clicking it switches the body.
  await dialog.getByRole('tab', { name: /OppPlayer/i }).click();
  await expect(dialog.getByText(/Full list not available/i)).toBeVisible();
});

test('decks modal: "View full page →" link points to per-player deck route', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'FullPager', email: 'fp@example.com' });
  const localId = 'fp-local-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'FullPager' },
    opponent: { username: 'Opp' },
    decks: {
      [localId]: {
        username: 'FullPager', name: null,
        leader: { id: 'ASH_005', count: 1 },
        base: { id: 'JTL_024', count: 1 },
        deck: [{ id: 'ASH_010', count: 3 }],
        sideboard: null,
      },
    },
  });
  await claimInstallToken(page, r.installToken);

  await page.goto(`/r/${r.slug}`);
  await page.getByRole('button', { name: /View decks/i }).click();
  const link = page.getByRole('dialog').getByRole('link', { name: /View full page/i });
  await expect(link).toHaveAttribute('href', `/r/${r.slug}/deck/${localId}`);
});

test('decks modal: closes on Escape', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'EscClose', email: 'ec@example.com' });
  const localId = 'ec-local-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'EscClose' },
    opponent: { username: 'Opp' },
    decks: {
      [localId]: {
        username: 'EscClose', name: null,
        leader: { id: 'ASH_005', count: 1 },
        base: { id: 'JTL_024', count: 1 },
        deck: [{ id: 'ASH_010', count: 3 }],
        sideboard: null,
      },
    },
  });
  await claimInstallToken(page, r.installToken);

  await page.goto(`/r/${r.slug}`);
  await page.getByRole('button', { name: /View decks/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
