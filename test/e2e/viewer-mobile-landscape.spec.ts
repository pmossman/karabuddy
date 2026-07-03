import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken } from './helpers';

// B216 redesign — the unified viewer chrome, SAME model on desktop and mobile:
//   - top-right RAIL of round buttons (aria-labels): "Sidebar" (toggles the one
//     feature panel) and "Tags" (toggles the floating Tag HUD).
//   - bottom-right transport cluster: "Jump to a moment" bubble + a big
//     Play/Pause FAB (aria-label flips "Play"/"Pause") with a small gear
//     plus a standalone gear circle (Playback view) atop the pocket column.
//   - ONE FeaturePanel hosting all whole-replay views behind a chip selector
//     (Tags / Reviews / Log / Matchup / Decks / Playback / Share / Clips).
//     Desktop → a right-docked <aside> (role=complementary); mobile → a
//     right-anchored slide-out drawer (role=dialog, aria-label = active view,
//     aria-modal) with a backdrop. While the mobile drawer is open the rail +
//     transport cluster are unmounted (the drawer covers the board chrome).
//   - The Tag HUD is an independent floating overlay; the mobile drawer covers
//     it (showHud = hudOpen && !mobileDrawer).
// Deep-link: ?panel=<view> opens the panel on that view ('info' = Matchup).
//
// This spec is the redesign-chrome coverage — it replaced the legacy
// FAB/sheet-era tests (MatchupPanel, StepModeOverlay, MobileControlsFab) when
// B216 cut over.

// Viewport must fit under the `(max-width: 900px)` breakpoint useMediaQuery
// uses for isMobile — Playwright doesn't simulate `pointer: coarse`. iPhone
// 12-ish landscape (844px) is comfortably under 900.
const MOBILE_LANDSCAPE = { width: 844, height: 390 };
const MOBILE_PORTRAIT = { width: 390, height: 844 };

// tokens.led.on (#4dd2ff) — the selected-state border on the panel's segmented
// controls (PlaybackFeature `seg(on)`), the only DOM signal of selection.
const LED_ON = 'rgb(77, 210, 255)';

async function loadReplay(page: Page, request: APIRequestContext) {
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
    // 10 distinct board positions after the initial full snapshot → an ~11-frame
    // collapsed timeline, so autoplay runs for several seconds (the Play↔Pause
    // toggle test needs playback to still be running when it asserts).
    extraGamestatePatches: 'BCDEFGHIJK'.split('').map((p) => ({ phase: p })),
  });
  await claimInstallToken(page, r.installToken);
  return r;
}

// The chrome mounts client-side — after goto, wait for the "Sidebar" rail
// button, then for the board sentinel to report decoded frames.
async function openViewer(page: Page, slug: string) {
  await page.goto(`/r/${slug}`);
  await expect(page.getByRole('button', { name: 'Sidebar' })).toBeVisible();
  await expect(page.getByTestId('board')).toHaveAttribute('data-frames', /^[1-9]\d*$/);
}

test('mobile: transport cluster is usable with the panel closed — Play↔Pause + gear→Playback view (landscape + portrait)', async ({ page, request }) => {
  for (const viewport of [MOBILE_LANDSCAPE, MOBILE_PORTRAIT]) {
    await page.setViewportSize(viewport);
    const r = await loadReplay(page, request);
    await openViewer(page, r.slug);

    // Panel closed by default; the transport cluster renders with the gear as a
    // STANDALONE circle in the pocket column (no barnacle on Play).
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const play = page.getByRole('button', { name: 'Play', exact: true });
    await expect(play).toBeVisible();
    await expect(page.getByRole('button', { name: 'Playback options' })).toBeVisible(); // mini-gear on Play's corner
    await expect(page.getByRole('button', { name: 'Jump to a moment' })).toBeVisible();

    // One-tap play: the FAB's label flips to Pause while playing, and back.
    await play.click();
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    await expect(pause).toBeVisible();
    await pause.click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

    // The mini-gear on Play's corner opens the panel straight to Playback.
    await page.getByRole('button', { name: 'Playback options' }).click();
    const drawer = page.getByRole('dialog', { name: 'Playback' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Speed', { exact: true })).toBeVisible();
  }
});

test('mobile: matchup starts hidden; rail Sidebar + the Matchup chip reveal it', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_LANDSCAPE);
  const r = await loadReplay(page, request);
  await openViewer(page, r.slug);

  // No panel on load — the matchup is collapsed into the sidebar's views.
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Rail "Sidebar" opens the drawer on its default Tags view…
  await page.getByRole('button', { name: 'Sidebar' }).click();
  await expect(page.getByRole('dialog', { name: 'Tags' })).toBeVisible();

  // …and the Matchup chip switches to the matchup content (players + VS).
  await page.getByRole('dialog').getByRole('button', { name: 'Matchup', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Matchup' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('VS', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText('MobUser').first()).toBeVisible();
  await expect(drawer.getByText('OppMob').first()).toBeVisible();
});

test('mobile: the drawer covers the board chrome and closes via its X, revealing the board again', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_LANDSCAPE);
  const r = await loadReplay(page, request);
  await openViewer(page, r.slug);

  await page.getByRole('button', { name: 'Sidebar' }).click();
  const drawer = page.getByRole('dialog', { name: 'Tags' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');

  // While the drawer is open the board-side chrome is unmounted — the rail and
  // the transport cluster are gone (the drawer covers the board).
  await expect(page.getByRole('button', { name: 'Sidebar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Jump to a moment' })).toHaveCount(0);

  // Explicit in-drawer close (the ✕ in the chip row's corner).
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sidebar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('mobile: one panel — the view chips swap content within the same drawer (Tags→Matchup)', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_PORTRAIT);
  const r = await loadReplay(page, request);
  await openViewer(page, r.slug);

  await page.getByRole('button', { name: 'Sidebar' }).click();
  const dialogs = page.getByRole('dialog');
  await expect(dialogs).toHaveCount(1);
  // Default view = Tags (empty feed on a fresh replay).
  await expect(dialogs.getByText('No tags on this replay yet.')).toBeVisible();
  // The full view selector is present inside the one drawer.
  for (const chip of ['Tags', 'Reviews', 'Log', 'Matchup', 'Decks', 'Playback', 'Share', 'Clips']) {
    await expect(dialogs.getByRole('button', { name: chip, exact: true })).toBeVisible();
  }

  // Switching chips swaps the content in place — still exactly one dialog,
  // Tags content gone, Matchup content in.
  await dialogs.getByRole('button', { name: 'Matchup', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Matchup' })).toBeVisible();
  await expect(dialogs.getByText('No tags on this replay yet.')).toHaveCount(0);
  await expect(dialogs.getByText('VS', { exact: true }).first()).toBeVisible();
});

test('matchup view exposes the title-edit pencil — owner only', async ({ page, request }) => {
  // Default Playwright viewport = desktop → the panel is the docked aside.
  const r = await loadReplay(page, request);
  await openViewer(page, r.slug);

  await page.getByRole('button', { name: 'Sidebar' }).click();
  const panel = page.getByRole('complementary');
  await panel.getByRole('button', { name: 'Matchup', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Edit replay title' })).toBeVisible();

  // Signed out (not the owner) → the same view renders the title read-only.
  await page.context().clearCookies();
  await openViewer(page, r.slug);
  await page.getByRole('button', { name: 'Sidebar' }).click();
  await panel.getByRole('button', { name: 'Matchup', exact: true }).click();
  await expect(panel.getByText('VS', { exact: true })).toBeVisible(); // view did load
  await expect(page.getByRole('button', { name: 'Edit replay title' })).toHaveCount(0);
});

test('share view carries no second title-edit control (dedupe guard)', async ({ page, request }) => {
  const r = await loadReplay(page, request);
  await openViewer(page, r.slug);

  await page.getByRole('button', { name: 'Sidebar' }).click();
  const panel = page.getByRole('complementary');
  await panel.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Copy replay link' })).toBeVisible();
  // The pencil lives ONLY in the Matchup view — the Share view must not grow
  // a duplicate (the old Share popover once carried its own).
  await expect(page.getByRole('button', { name: 'Edit replay title' })).toHaveCount(0);
});

test('desktop: gear opens the Playback view; picking a speed selects it (B173)', async ({ page, request }) => {
  const r = await loadReplay(page, request);
  await openViewer(page, r.slug);

  await page.getByRole('button', { name: 'Playback options' }).click();
  const panel = page.getByRole('complementary');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Speed', { exact: true })).toBeVisible();

  // Selection is exposed as the segmented button's lit (LED) border — assert
  // the computed style, the only DOM signal (no aria-pressed on these).
  const oneX = panel.getByRole('button', { name: '1×', exact: true });
  const fastX = panel.getByRole('button', { name: '1.5×', exact: true });
  await expect(oneX).toHaveCSS('border-top-color', LED_ON); // default = 1×
  await expect(fastX).not.toHaveCSS('border-top-color', LED_ON);

  await fastX.click();
  await expect(fastX).toHaveCSS('border-top-color', LED_ON); // stays selected
  await expect(oneX).not.toHaveCSS('border-top-color', LED_ON);
});

test('desktop: the panel docks on the RIGHT and closes via the rail toggle AND its X', async ({ page, request }) => {
  const r = await loadReplay(page, request);
  await openViewer(page, r.slug);

  const toggle = page.getByRole('button', { name: 'Sidebar' });
  await toggle.click();
  const panel = page.getByRole('complementary');
  await expect(panel).toBeVisible();

  // Geometric check: docked aside's right edge ~= viewport right edge.
  const box = await panel.boundingBox();
  const vp = page.viewportSize();
  expect(box && vp && Math.abs(box.x + box.width - vp.width) < 5).toBe(true);

  // Rail toggle closes it (the rail stays mounted on desktop)…
  await toggle.click();
  await expect(page.getByRole('complementary')).toHaveCount(0);

  // …and so does the panel's own ✕.
  await toggle.click();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('complementary')).toHaveCount(0);
});

test('mobile: playback view exposes Speed + Step-by controls (landscape + portrait)', async ({ page, request }) => {
  for (const viewport of [MOBILE_LANDSCAPE, MOBILE_PORTRAIT]) {
    await page.setViewportSize(viewport);
    const r = await loadReplay(page, request);
    await openViewer(page, r.slug);

    await page.getByRole('button', { name: 'Playback options' }).click();
    const drawer = page.getByRole('dialog', { name: 'Playback' });
    await expect(drawer).toBeVisible();
    // Literal speed multipliers (relative to the retuned 1× baseline).
    await expect(drawer.getByText('Speed', { exact: true })).toBeVisible();
    for (const s of ['0.75×', '1×', '1.5×']) {
      await expect(drawer.getByRole('button', { name: s, exact: true })).toBeVisible();
    }
    // Step granularity.
    await expect(drawer.getByText('Step by', { exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Action', exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Frame', exact: true })).toBeVisible();
  }
});

test('mobile: matchup view exposes title-edit + add-label; ?panel=info deep-links to it (landscape + portrait)', async ({ page, request }) => {
  for (const viewport of [MOBILE_LANDSCAPE, MOBILE_PORTRAIT]) {
    await page.setViewportSize(viewport);
    const r = await loadReplay(page, request);
    // Deep-link straight into the Matchup view ('info'). The drawer opens on
    // mount, so the rail is covered — wait on the drawer itself.
    await page.goto(`/r/${r.slug}?panel=info`);
    const drawer = page.getByRole('dialog', { name: 'Matchup' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Edit replay title' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Add label' })).toBeVisible();
  }
});

test('mobile portrait: the drawer is a full-screen-ish overlay (no split sheets)', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_PORTRAIT);
  const r = await loadReplay(page, request);
  await openViewer(page, r.slug);

  await page.getByRole('button', { name: 'Sidebar' }).click();
  const drawer = page.getByRole('dialog', { name: 'Tags' });
  await expect(drawer).toBeVisible();

  // One right-anchored drawer covering (nearly) the whole viewport — the old
  // top/bottom split-sheet geometry is gone. Poll: the drawer slides in over
  // ~220ms (kb-drawer-in), so an immediate boundingBox catches it mid-flight.
  const vp = page.viewportSize();
  await expect.poll(async () => {
    const box = await drawer.boundingBox();
    if (!box || !vp) return 'no-box';
    if (box.width < vp.width * 0.85) return `narrow:${box.width}`; // min(440px, 92vw)
    if (box.height < vp.height * 0.95) return `short:${box.height}`; // top:0..bottom:0
    if (Math.abs(box.x + box.width - vp.width) >= 5) return `off-right:${box.x + box.width}`;
    return 'ok';
  }).toBe('ok');

  // Board chrome is covered while open; closing reveals it again.
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('mobile: rail Tags toggles the floating HUD; the drawer covers it while open', async ({ page, request }) => {
  await page.setViewportSize(MOBILE_LANDSCAPE);
  const r = await loadReplay(page, request);
  await openViewer(page, r.slug);

  // HUD starts closed (the board loads clean).
  await expect(page.getByTestId('taghud-drag')).toHaveCount(0);

  // Rail "Tags" opens the floating HUD (empty state on a fresh replay).
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(page.getByTestId('taghud-drag')).toBeVisible();
  await expect(page.getByText('No tags on this frame')).toBeVisible();

  // Opening the drawer hides the HUD (showHud = hudOpen && !mobileDrawer)…
  await page.getByRole('button', { name: 'Sidebar' }).click();
  await expect(page.getByRole('dialog', { name: 'Tags' })).toBeVisible();
  await expect(page.getByTestId('taghud-drag')).toHaveCount(0);

  // …and closing it restores the HUD (hudOpen was never flipped off).
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('taghud-drag')).toBeVisible();

  // The HUD's own ✕ closes it for real.
  await page.getByRole('button', { name: 'Close tags' }).click();
  await expect(page.getByTestId('taghud-drag')).toHaveCount(0);
});
