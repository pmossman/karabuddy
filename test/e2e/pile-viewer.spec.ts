import { test, expect } from '@playwright/test';
import { uploadReplay } from './helpers';

// Clicking a discard / resource pile in the replay viewer opens a pile viewer of
// the cards in it — mirroring a live karabast match. The lifted trays already
// fired togglePopup('pile', …); this covers the renderer that surfaces them.

test('clicking my discard pile opens a viewer listing its cards', async ({ page, request }) => {
  const { slug } = await uploadReplay(request, {
    local: { username: 'PileP1', discardCards: [{ set: 'ASH', number: 5 }, { set: 'ASH', number: 6 }] },
    opponent: { username: 'PileP2' },
  });
  await page.goto(`/r/${slug}`);

  // No popup until a pile is clicked.
  await expect(page.getByTestId('pile-viewer')).toHaveCount(0);

  await page.getByTestId('my-discard-pile').click();
  const viewer = page.getByTestId('pile-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText(/discard/i);
  // Both discarded cards render (GameCard tags each with its uuid).
  await expect(viewer.locator('[data-card-uuid="local-discard-0"]')).toBeVisible();
  await expect(viewer.locator('[data-card-uuid="local-discard-1"]')).toBeVisible();

  // Backdrop click dismisses it.
  await page.getByTestId('pile-viewer-overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('pile-viewer')).toHaveCount(0);
});

test('clicking a resource pile opens the viewer (empty pile reads as such)', async ({ page, request }) => {
  const { slug } = await uploadReplay(request, {
    local: { username: 'ResP1' },
    opponent: { username: 'ResP2' },
  });
  await page.goto(`/r/${slug}`);

  await page.getByTestId('my-resource-pile').click();
  const viewer = page.getByTestId('pile-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText(/resources/i);
  await expect(viewer).toContainText(/no cards/i); // fixture resource pile is empty
});
