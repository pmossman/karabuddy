import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B66 → B100: mobile viewer chrome. Two independent FABs in the bottom-right:
//   - ☰  "Open/Close tags panel" → the REVIEW sheet (what-happened + tags +
//        tag form). Bottom sheet in portrait, right sheet in landscape.
//        Draggable (clear grabber on the edge nearest the board) + an explicit
//        × close inside the sheet header.
//   - ⓘ  "Show/Hide matchup info" → the MATCHUP sheet (chips + title + decks).
//        Top sheet in portrait, left sheet in landscape. Collapsed by default
//        (rarely needed mid-replay). Also draggable.
// The two are mutually exclusive on mobile (opening one closes the other) so
// they never sandwich the board — that simultaneity was the old "mess".
//
// B104: the ⓘ matchup FAB moved to the TOP edge (top-right portrait /
// top-left landscape — matching where its panel slides in). Playback controls
// collapsed off the cramped bottom edge into a single joined capsule in the
// bottom-right cluster: a one-tap play/pause fused to a "Playback settings"
// opener that surfaces a bubble (Speed / Step by / Card animation). On desktop
// those same finer controls collapse behind a settings cog on the playback pill
// (play + cog always visible). The prev/next chevrons are pinned to the screen
// edges and don't move when a sheet opens.
//
// Portrait + landscape share the model now (the old portrait/landscape split
// only differed in which edges the sheets slide from).

// Viewport must fit under the `(max-width: 900px)` breakpoint that
// useMediaQuery uses for isMobile — Playwright doesn't simulate
// `pointer: coarse`. iPhone 12-ish landscape (844px) is comfortably under 900.
const MOBILE_LANDSCAPE = { width: 844, height: 390 };
const MOBILE_PORTRAIT = { width: 390, height: 844 };

async function loadReplay(page: any, request: any) {
  await signInAsTestUser(page, { name: 'MobUser', email: 'mu@example.com' });
  const localId = 'mob-l-' + Math.random().toString(36).slice(2, 8);
  const r = await uploadReplay(request, {
    local: { id: localId, username: 'MobUser' },
    opponent: { username: 'OppMob' },
    decks: {
      [localId]: {
        username: 'MobUser', name: null,
        leader: { id: 'ASH_005', count: 1 },
        base: { id: 'JTL_024', count: 1 },
        deck: [{ id: 'ASH_010', count: 3 }],
        sideboard: null,
      },
    },
  });
  await claimInstallToken(page, r.installToken);
  return r;
}

test('mobile: playback capsule is always visible — one-tap play + a settings opener (sheets closed)', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_LANDSCAPE);
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);
  // Both sheets are closed by default. The playback capsule still renders:
  // a one-tap play/pause (its own button, not buried in the bubble) fused to
  // the settings opener that surfaces the finer controls.
  await expect(page.getByRole('button', { name: /^Play$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Playback settings/i })).toBeVisible();
  // The play control is NOT inside the (closed) settings bubble — it's always
  // reachable in one tap. Opening settings is a separate affordance.
  await expect(page.getByRole('dialog', { name: /Playback controls/i })).toHaveCount(0);
});

test('mobile: matchup is collapsed by default and opens via the ⓘ FAB (LEFT-anchored in landscape)', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_LANDSCAPE);
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);

  // Collapsed by default — the matchup FAB exists but the panel hasn't slid in.
  const fab = page.getByRole('button', { name: /matchup info/i });
  await expect(fab).toBeVisible();

  await fab.click();
  const panel = page.getByTestId('match-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-anchor', 'left');
  await expect(panel.getByRole('button', { name: /View decks/i })).toBeVisible();
});

test('mobile: ☰ opens the review sheet; it holds what-happened + tag form, never the matchup/decks', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_LANDSCAPE);
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);

  await page.getByRole('button', { name: /Open tags/i }).click();
  const drawer = page.getByTestId('tags-drawer');
  await expect(drawer).toBeVisible();
  // B100/B149: log + review split into a Review|Game log toggle. With no tags on
  // this replay the default is the game log (content-aware default).
  await expect(drawer.getByText(/What happened/i)).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Tag this frame/i })).toHaveCount(0);
  // Switch to the Review tab → the tag form appears, the log goes away.
  await drawer.getByRole('button', { name: /^Tags/ }).click();
  await expect(drawer.getByRole('button', { name: /Tag this frame/i })).toBeVisible();
  await expect(drawer.getByText(/What happened/i)).toHaveCount(0);
  // The matchup + decks live on the separate matchup sheet.
  await expect(drawer.getByRole('button', { name: /View decks/i })).toHaveCount(0);
  // Clear drag handle to resize the sheet.
  await expect(drawer.getByRole('separator', { name: /resize review panel/i })).toBeVisible();
  // Explicit in-sheet close (the FAB is covered while the sheet is open). The
  // sheet slides out via transform (stays mounted, so assert the FAB's label
  // flips back rather than checking visibility of an off-screen element).
  await drawer.getByRole('button', { name: /Close tags panel/i }).click();
  await expect(page.getByRole('button', { name: /Open tags panel/i })).toBeVisible();
});

test('mobile: the two sheets are mutually exclusive (opening matchup closes review)', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_PORTRAIT);
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);

  await page.getByRole('button', { name: /Open tags/i }).click();
  const drawer = page.getByTestId('tags-drawer');
  await expect(drawer).toBeVisible();

  await page.getByRole('button', { name: /matchup info/i }).click();
  const panel = page.getByTestId('match-panel');
  await expect(panel).toBeVisible();
  // Review slid back out when matchup opened — its FAB reverts to "Open".
  await expect(page.getByRole('button', { name: /Open tags panel/i })).toBeVisible();
});

// Title + Edit button surfaced in the sidebar header (own affordance,
// not buried inside the Share popover).
test('sidebar exposes a title edit button (pencil) outside the Share popover', async ({ page, request }) => {
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);
  await expect(page.getByRole('button', { name: /Edit replay title/i })).toBeVisible();
});

test('opening Share does NOT also show a second title-edit button (de-duplicated)', async ({ page, request }) => {
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByRole('button', { name: /Edit replay title/i })).toHaveCount(1);
});

// B66b: desktop mirrors the mobile-landscape chrome — chevrons + step-overlay
// + ☰ toggle + right-anchored sidebar.

test('desktop: frame-nav chevrons render over the gameboard', async ({ page, request }) => {
  // Default Playwright viewport is desktop (1280×720).
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);
  await expect(page.getByRole('button', { name: 'Previous frame' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next frame' })).toBeVisible();
});

test('desktop: no matchup FAB (matchup lives in the docked sidebar header)', async ({ page, request }) => {
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);
  await expect(page.getByRole('button', { name: /matchup info/i })).toHaveCount(0);
});

test('desktop: playback pill is collapsed by default; the cog expands the full controls', async ({ page, request }) => {
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);
  const overlay = page.getByTestId('step-mode-overlay');
  await expect(overlay).toBeVisible();
  // Always visible: the play button + the settings cog. Everything else (speed /
  // step-by / animate) is collapsed behind the cog so the pill isn't a wide bar.
  await expect(overlay.getByRole('button', { name: /^Play$/ })).toBeVisible();
  const cog = overlay.getByTestId('controls-collapse-toggle');
  await expect(cog).toBeVisible();
  await expect(cog).toHaveAttribute('aria-expanded', 'false');
  await expect(overlay.getByTestId('playback-extra-controls')).toHaveAttribute('data-open', '0');

  // Cog expands → the finer controls slide out and become interactive.
  await cog.click();
  await expect(cog).toHaveAttribute('aria-expanded', 'true');
  await expect(overlay.getByTestId('playback-extra-controls')).toHaveAttribute('data-open', '1');
  await expect(overlay.getByText(/Step by/i)).toBeVisible();
  await expect(overlay.getByRole('button', { name: /^Action$/ })).toBeVisible();

  // Cog collapses again (preference persists, but here we just verify the toggle).
  await cog.click();
  await expect(overlay.getByTestId('playback-extra-controls')).toHaveAttribute('data-open', '0');
});

test('desktop: picking a playback speed updates the value (B173)', async ({ page, request }) => {
  // Regression: the speed dropdown opens ABOVE the bottom-edge pill, but the
  // pill's collapse animation clips it with overflow:hidden. It used to vanish —
  // the caret flipped but no list showed, so the value never changed. The list
  // is now portalled to <body>, escaping the clip.
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);
  const overlay = page.getByTestId('step-mode-overlay');
  await overlay.getByTestId('controls-collapse-toggle').click();

  const chip = overlay.getByRole('button', { name: /^Playback speed:/ });
  const before = await chip.getAttribute('aria-label');
  await chip.click();

  // Portalled to <body> — query at page scope, NOT within the overlay.
  const listbox = page.getByRole('listbox', { name: /Playback speed/i });
  await expect(listbox).toBeVisible();
  // The real guard: the list must live OUTSIDE the overflow:hidden controls
  // region (which clipped it before) — i.e. portalled directly under <body>.
  await expect(overlay.getByTestId('playback-extra-controls').getByRole('listbox')).toHaveCount(0);
  await expect(page.locator('body > div[role="listbox"][aria-label="Playback speed"]')).toBeVisible();
  const target = before?.includes('1.5') ? '1×' : '1.5×';
  await listbox.getByRole('option', { name: target, exact: true }).click();

  await expect(chip).toHaveAttribute('aria-label', `Playback speed: ${target}`);
  await expect(listbox).toHaveCount(0); // closes on pick
});

test('desktop: sidebar opens on the RIGHT and can be dismissed via ☰', async ({ page, request }) => {
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);
  const drawer = page.getByTestId('tags-drawer');
  await expect(drawer).toBeVisible();

  // Geometric check: sidebar right edge ~= viewport right edge.
  const box = await drawer.boundingBox();
  const vp = page.viewportSize();
  expect(box && vp && Math.abs((box.x + box.width) - vp.width) < 5).toBe(true);

  // The ☰ FAB toggles the docked sidebar (open + close from one affordance).
  const toggle = page.getByRole('button', { name: /tags panel/i });
  await toggle.click();
  await expect(drawer).toHaveCount(0);
  await toggle.click();
  await expect(drawer).toBeVisible();
});

test('mobile: playback-settings bubble exposes Speed + Step by (landscape + portrait)', async ({ page, request }) => {
  for (const viewport of [MOBILE_LANDSCAPE, MOBILE_PORTRAIT]) {
    await page.setViewportSize(viewport);
    const r = await loadReplay(page, request);
    await page.goto(`/r/${r.slug}`);
    // The finer controls live behind the capsule's settings opener.
    await page.getByRole('button', { name: /Playback settings/i }).click();
    const bubble = page.getByRole('dialog', { name: /Playback controls/i });
    await expect(bubble).toBeVisible();
    await expect(bubble.getByText(/Step by/i)).toBeVisible();
    await expect(bubble.getByRole('button', { name: /^Action$/ })).toBeVisible();
    await expect(bubble.getByRole('button', { name: /^Frame$/ })).toBeVisible();
    // Literal speed multipliers (shared with the clip reel — 0.5× / 1× / 2×).
    await expect(bubble.getByText(/Speed/i)).toBeVisible();
    await expect(bubble.getByRole('button', { name: /^1×$/ })).toBeVisible();
  }
});

test('mobile MatchupPanel exposes title-edit + add-label affordances (landscape + portrait)', async ({ page, request }) => {
  for (const viewport of [MOBILE_LANDSCAPE, MOBILE_PORTRAIT]) {
    await page.setViewportSize(viewport);
    const r = await loadReplay(page, request);
    await page.goto(`/r/${r.slug}`);
    await page.getByRole('button', { name: /matchup info/i }).click();
    const panel = page.getByTestId('match-panel');
    await expect(panel.getByRole('button', { name: /Edit replay title/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: /Add label/i })).toBeVisible();
  }
});

test('mobile portrait: matchup slides from the TOP, review from the BOTTOM (split top/bottom)', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_PORTRAIT);
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);

  // Matchup → top sheet.
  await page.getByRole('button', { name: /matchup info/i }).click();
  const panel = page.getByTestId('match-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-anchor', 'top');
  await expect(panel.getByRole('button', { name: /View decks/i })).toBeVisible();

  // Review → bottom sheet (opening it closes the matchup sheet).
  await page.getByRole('button', { name: /Open tags/i }).click();
  const drawer = page.getByTestId('tags-drawer');
  await expect(drawer).toBeVisible();
  // B149: Game-log tab by default (no tags on this replay); Review tab holds the form.
  await expect(drawer.getByText(/What happened/i)).toBeVisible();
  await drawer.getByRole('button', { name: /^Tags/ }).click();
  await expect(drawer.getByRole('button', { name: /Tag this frame/i })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /View decks/i })).toHaveCount(0);
});
