import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B66: mobile landscape viewer rework. Currently the single right-side
// drawer holds everything (matchup, share, decks, step toggle,
// what-happened, tags). That's cramped on phone landscape. Splitting:
//   - Step toggle → small overlay pill near the menu button. Always
//     visible (mobile only), not gated by drawer open/close.
//   - Matchup + share + "View decks" → left slide-in panel that opens
//     alongside the drawer when ☰ is tapped. Landscape only.
//   - Right drawer stays for "what happened" + tags + tag form.
// Portrait stays single-drawer (not enough width for two panels).

// Viewport must fit under the `(max-width: 900px)` breakpoint that
// useMediaQuery uses for isMobile — Playwright doesn't simulate
// `pointer: coarse`. iPhone 12-ish landscape (844px) is comfortably
// under 900.
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

test('mobile landscape: step-toggle overlay is always visible (drawer closed)', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_LANDSCAPE);
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);
  // Drawer is closed by default. The overlay should still render.
  const overlay = page.getByTestId('step-mode-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole('button', { name: /^Action$/ })).toBeVisible();
  await expect(overlay.getByRole('button', { name: /^Frame$/ })).toBeVisible();
});

test('mobile landscape: tapping ☰ reveals a LEFT-anchored matchup panel + right drawer', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_LANDSCAPE);
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);

  await page.getByRole('button', { name: /Open tags/i }).click();
  const panel = page.getByTestId('match-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-anchor', 'left');
  await expect(panel.getByRole('button', { name: /View decks/i })).toBeVisible();
});

test('mobile landscape: right drawer no longer contains matchup or View decks', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_LANDSCAPE);
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);

  await page.getByRole('button', { name: /Open tags/i }).click();
  const drawer = page.getByTestId('tags-drawer');
  // What-happened + tag form stay in the drawer.
  await expect(drawer.getByText(/What happened/i)).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Tag this frame/i })).toBeVisible();
  // View decks moved to the LEFT panel; drawer should not have it.
  await expect(drawer.getByRole('button', { name: /View decks/i })).toHaveCount(0);
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

// B66b: desktop now mirrors mobile landscape — chevrons + step-overlay
// + ☰ toggle + right-anchored sidebar.

test('desktop: frame-nav chevrons render over the gameboard', async ({ page, request }) => {
  // Default Playwright viewport is desktop (1280×720).
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);
  await expect(page.getByRole('button', { name: 'Previous frame' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next frame' })).toBeVisible();
});

test('desktop: step-mode overlay renders too (with "Step by:" label)', async ({ page, request }) => {
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);
  const overlay = page.getByTestId('step-mode-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText(/Step by/i)).toBeVisible();
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

  // The ☰ button itself is the toggle — same visible affordance opens
  // and closes the sidebar (no separate × hunt). Click once to close,
  // click again to reopen.
  const toggle = page.getByRole('button', { name: /tags panel/i });
  await toggle.click();
  await expect(drawer).toHaveCount(0);
  await toggle.click();
  await expect(drawer).toBeVisible();
});

test('step-mode overlay shows an explicit "Step by:" label (landscape + portrait)', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_LANDSCAPE);
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);
  await expect(page.getByTestId('step-mode-overlay').getByText(/Step by/i)).toBeVisible();

  await page.setViewportSize(MOBILE_PORTRAIT);
  // The overlay rerenders on resize via useMediaQuery — label still present.
  await expect(page.getByTestId('step-mode-overlay').getByText(/Step by/i)).toBeVisible();
});

test('mobile portrait: ☰ reveals a TOP-anchored matchup panel + bottom drawer (split top/bottom)', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_PORTRAIT);
  const r = await loadReplay(page, request);
  await page.goto(`/r/${r.slug}`);

  await page.getByRole('button', { name: /Open tags/i }).click();
  // Same split principle as landscape, but the panels slide in from the
  // top and bottom edges instead of left/right (since portrait is too
  // narrow for two horizontal panels). Gameboard stays partially visible
  // in the middle band.
  const panel = page.getByTestId('match-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-anchor', 'top');
  await expect(panel.getByRole('button', { name: /View decks/i })).toBeVisible();

  // Bottom drawer carries "what happened" + tag form; matchup/decks are
  // on the top panel, not duplicated here.
  const drawer = page.getByTestId('tags-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(/What happened/i)).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Tag this frame/i })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /View decks/i })).toHaveCount(0);
});
