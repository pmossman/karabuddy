import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// Lostrian's feedback (2026-07-02): opening the composer clipped the Save button
// below the HUD's pinned height (manual resize needed EVERY tag), and a manual
// resize wasn't remembered across visits.

async function openHudComposer(page: import('@playwright/test').Page, slug: string) {
  await page.goto(`/r/${slug}`);
  await expect(page.getByTestId('board')).toBeVisible();
  // B216: compose lives in the floating Tag HUD — the rail "Tags" button opens it.
  // The HUD remembers being open across visits, so only toggle it when needed.
  const addTag = page.getByRole('button', { name: 'Add tag' });
  if (!(await addTag.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Tags', exact: true }).click();
  }
  await addTag.click();
  await expect(page.getByRole('button', { name: 'Save' })).toBeAttached();
}

test('tag composer: Save is fully inside the HUD without manual resizing', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Hud Tagger' });
  const { slug, installToken } = await uploadReplay(request, {
    local: { username: 'HudTagger' },
    opponent: { username: 'Opp' },
  });
  await claimInstallToken(page, installToken);
  await openHudComposer(page, slug);

  const save = page.getByRole('button', { name: 'Save' });
  const bubble = page.locator('[data-testid="taghud-drag"]').locator('..'); // the glass bubble
  // The panel animates its grow — poll until Save's bottom sits inside the bubble.
  await expect
    .poll(async () => {
      const s = await save.boundingBox();
      const b = await bubble.boundingBox();
      if (!s || !b) return 1e9;
      return s.y + s.height - (b.y + b.height); // ≤0 → fully inside
    }, { timeout: 5000 })
    .toBeLessThanOrEqual(0);
});

test('HUD remembers a manual resize across visits', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Hud Resizer' });
  const { slug, installToken } = await uploadReplay(request, {
    local: { username: 'HudResizer' },
    opponent: { username: 'Opp' },
  });
  await claimInstallToken(page, installToken);
  await openHudComposer(page, slug);

  const bubble = page.locator('[data-testid="taghud-drag"]').locator('..');
  const grip = page.getByTestId('taghud-resize');
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 140, g.y + 90, { steps: 8 });
  await page.mouse.up();
  const grown = (await bubble.boundingBox())!;

  // Fresh visit → the HUD comes back at the remembered size (±2px).
  await openHudComposer(page, slug);
  const restored = (await bubble.boundingBox())!;
  expect(Math.abs(restored.width - grown.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(restored.height - grown.height)).toBeLessThanOrEqual(2);
});
