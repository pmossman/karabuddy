import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B65: opponent's deck tab surfaces cards we OBSERVED them play during
// the match — leader+base + every card that hit their visible zones,
// since karabast masks the full decklist. Helps "what did they actually
// run?" reviews without exposing hidden hand contents.

test('opponent tab in decks modal shows "Seen during play" + cards', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'SeenView', email: 'sv@example.com' });
  const localId = 'sv-l-' + Math.random().toString(36).slice(2, 8);
  const oppId = 'sv-o-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'SeenView' },
    opponent: {
      id: oppId,
      username: 'Opp',
      seenCards: [
        { set: 'ASH', number: 50 },
        { set: 'ASH', number: 60 },
        { set: 'JTL', number: 100 },
      ],
    },
    decks: {
      [localId]: {
        username: 'SeenView', name: null,
        leader: { id: 'ASH_005', count: 1 },
        base: { id: 'JTL_024', count: 1 },
        deck: [{ id: 'ASH_010', count: 3 }],
        sideboard: null,
      },
      [oppId]: {
        username: 'Opp', name: null,
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
  await dialog.getByRole('tab', { name: /Opp/i }).click();

  // Section heading + each observed card by id.
  await expect(dialog.getByRole('heading', { name: /Seen during play/i })).toBeVisible();
  await expect(dialog.getByTitle(/ASH_050/)).toBeVisible();
  await expect(dialog.getByTitle(/ASH_060/)).toBeVisible();
  await expect(dialog.getByTitle(/JTL_100/)).toBeVisible();
});

test('local-player tab does not show "Seen during play" (we already have the full deck)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'LocalOnly', email: 'lo@example.com' });
  const localId = 'lo-l-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'LocalOnly' },
    opponent: {
      username: 'Opp',
      seenCards: [{ set: 'ASH', number: 50 }],
    },
    decks: {
      [localId]: {
        username: 'LocalOnly', name: null,
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
  const dialog = page.getByRole('dialog');
  // Default tab is local player — no Seen-during-play heading visible.
  await expect(dialog.getByRole('heading', { name: /Seen during play/i })).toHaveCount(0);
});

// B65b: the standalone deck PAGE is now the same tabbed experience as the modal
// (shared <DecksTabs>), and surfaces opponents' "Seen during play" by decoding
// the payload blob server-side (the viewer reuses its client frames).
test('deck PAGE: tabbed per-player + opponent tab shows server-decoded "Seen during play"', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'PageSeen', email: 'pgsn@example.com' });
  const localId = 'pgsn-l-' + Math.random().toString(36).slice(2, 8);
  const oppId = 'pgsn-o-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'PageSeen' },
    opponent: {
      id: oppId,
      username: 'Opp',
      seenCards: [
        { set: 'ASH', number: 50 },
        { set: 'ASH', number: 60 },
        { set: 'JTL', number: 100 },
      ],
    },
    decks: {
      [localId]: {
        username: 'PageSeen', name: null,
        leader: { id: 'ASH_005', count: 1 },
        base: { id: 'JTL_024', count: 1 },
        deck: [{ id: 'ASH_010', count: 3 }],
        sideboard: null,
      },
      [oppId]: {
        username: 'Opp', name: null,
        leader: { id: 'ASH_014', count: 1 },
        base: { id: 'JTL_024', count: 1 },
        deck: null,
        sideboard: null,
      },
    },
  });
  await claimInstallToken(page, r.installToken);

  // Land directly on the opponent's per-player deck page.
  await page.goto(`/r/${r.slug}/deck/${oppId}`);
  // Same tabbed experience as the modal — both players' tabs present.
  await expect(page.getByRole('tab', { name: /PageSeen/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Opp/i })).toBeVisible();
  // Opponent (initial) tab surfaces the server-decoded "seen during play" cards.
  await expect(page.getByRole('heading', { name: /Seen during play/i })).toBeVisible();
  await expect(page.getByTitle(/ASH_050/)).toBeVisible();
  await expect(page.getByTitle(/JTL_100/)).toBeVisible();
});

test('opponent tab with no observed cards: section either hidden or empty-state', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'NoSeen', email: 'ns@example.com' });
  const localId = 'ns-l-' + Math.random().toString(36).slice(2, 8);
  const oppId = 'ns-o-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'NoSeen' },
    opponent: { id: oppId, username: 'OppNoSeen' /* no seenCards */ },
    decks: {
      [oppId]: {
        username: 'OppNoSeen', name: null,
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
  await dialog.getByRole('tab', { name: /OppNoSeen/i }).click();
  // No cards = no "Seen during play" heading (matches "deferring section
  // until there's something to show" pattern from B61 Discussion empty).
  await expect(dialog.getByRole('heading', { name: /Seen during play/i })).toHaveCount(0);
});
