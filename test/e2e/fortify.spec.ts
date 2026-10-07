import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fortifyPayload } from '../fixtures/karabast-fortify';

// Fortify (Homeworlds): upgrades attached to a BASE ride on the base's summary
// (players[pid].base.upgrades) and render as a band of tabs on the base's
// board-facing edge. The fixture: Alice (recorder) carries 1 fortification, Bob
// carries 2 → 3 → 4 (the band collapses the oldest into "+2") → 3 after
// Confiscate defeats one of the named tabs.

async function uploadFortify(page: Page): Promise<string> {
  const payload = JSON.stringify(fortifyPayload({ gameId: `fortify-${randomUUID()}` }));
  const res = await page.request.post('/api/replays', { data: { installToken: `kbx_${randomUUID()}`, payload } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).slug;
}

const band = (page: Page, base: string) => page.locator(`[data-card-uuid="${base}"] [data-testid="fortification-band"]`);

test('fortifications render on both bases, collapse past three, and leave when defeated', async ({ page }) => {
  const slug = await uploadFortify(page);

  // Frame 1: Bob's base already has two; Alice's has none (no band at all).
  await page.goto(`/r/${slug}?f=1`);
  await expect(band(page, 'p2-base').getByTestId('fortification-tab')).toHaveText(['Dark Sanctum', 'Military Academy']);
  await expect(band(page, 'p1-base')).toHaveCount(0);

  // Frame 5: Alice has one; Bob has four → "+2" chip + the two newest named.
  await page.goto(`/r/${slug}?f=5`);
  await expect(band(page, 'p1-base').getByTestId('fortification-tab')).toHaveText(['Alliance Shield Generator']);
  await expect(band(page, 'p2-base')).toHaveAttribute('data-count', '4');
  await expect(band(page, 'p2-base').getByTestId('fortification-overflow')).toHaveText('+2');
  await expect(band(page, 'p2-base').getByTestId('fortification-tab')).toHaveText(['Sinister War Memorial', 'Intelligence Agency']);

  // Neither band covers its base's damage badge.
  for (const base of ['p1-base', 'p2-base']) {
    const b = await band(page, base).boundingBox();
    const dmg = await page.locator(`[data-card-uuid="${base}"] [data-testid="base-damage"] > *`).first().boundingBox();
    expect(b && dmg).toBeTruthy();
    const overlaps = b!.x < dmg!.x + dmg!.width && dmg!.x < b!.x + b!.width && b!.y < dmg!.y + dmg!.height && dmg!.y < b!.y + b!.height;
    expect(overlaps, `${base} band covers the damage badge`).toBe(false);
  }

  // Hovering a tab previews that card.
  const previewImages = () => page.evaluate(() =>
    [...document.querySelectorAll('.MuiPopover-paper *')].map((el) => getComputedStyle(el).backgroundImage).filter((b) => b.includes('/cards/')));
  await band(page, 'p1-base').getByTestId('fortification-tab').hover();
  await expect.poll(previewImages).toEqual([expect.stringContaining('HMW/en/standard/large/081')]);
  // …and the "+2" chip previews both cards it collapsed.
  await page.mouse.move(0, 0);
  await band(page, 'p2-base').getByTestId('fortification-overflow').hover();
  await expect.poll(previewImages).toEqual([expect.stringContaining('HMW/en/standard/large/070'), expect.stringContaining('HMW/en/standard/large/112')]);
  await page.mouse.move(0, 0);

  // Frame 6: Confiscate defeated Sinister War Memorial → three named tabs, no chip.
  await page.goto(`/r/${slug}?f=6`);
  await expect(band(page, 'p2-base').getByTestId('fortification-tab')).toHaveText(['Dark Sanctum', 'Military Academy', 'Intelligence Agency']);
  await expect(band(page, 'p2-base').getByTestId('fortification-overflow')).toHaveCount(0);
});
