import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, uploadReplay, claimInstallToken } from './helpers';

// Regression guard: on a phone the signed-in sidebar shell stacks as a column
// (top bar → content), so the page content is full-width — NOT squeezed into a
// flex item beside the sticky mobile bar (the shipped-then-fixed mobile bug).
test('mobile: signed-in content is full-width, not squeezed beside the sidebar', async ({ page }) => {
  await signInAsTestUser(page, { name: 'MobileShell' });
  const { slug } = await createTeam(page, 'Shell Team');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/teams/${slug}?tab=members`);

  // The AppShell content wrapper (outer main); the team page nests its own main.
  const box = await page.getByRole('main').first().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(330); // ~full 390 viewport, not ~half
});

// Regression guard: at intermediate widths (~1000–1280px, e.g. DevTools docked)
// the dashboard's "Team replays" + "Reviews" cards stay two-up. The Deck art has
// overflow:hidden, so a too-narrow grid track silently CLIPS the leader/base art
// at the card edge (the fix: minmax(0,1fr) tracks + drop the matchup names in
// that band). Assert every card-art image sits fully inside its card.
test('dashboard: review/replay card art is not clipped at intermediate widths', async ({ page }) => {
  await signInAsTestUser(page, { name: 'DashWidth' });
  const { slug } = await createTeam(page, 'Dash Width Team');

  // Replays shared to the team, with long leader/base names + team comments so
  // both the Team replays and Reviews cards render matchup rows.
  for (let i = 0; i < 3; i++) {
    const { slug: rSlug, installToken } = await uploadReplay(page.request, {
      local: { username: `me${i}`, leaderName: 'Luke Skywalker, Faithful Friend' },
      opponent: { username: `opp${i}`, leaderName: 'The Mandalorian, Sworn to the Creed' },
      shareTeamSlugs: [slug],
    });
    await claimInstallToken(page, installToken);
    await page.request.post(`/api/replays/${rSlug}/tags`, {
      data: { installToken, authorName: 'DashWidth', frameIndex: 0, comment: `note ${i}`, teamSlugs: [slug] },
    });
  }

  await page.setViewportSize({ width: 1120, height: 900 });
  await page.goto(`/teams/${slug}`);
  await page.getByText('Team replays', { exact: false }).first().waitFor();

  const clipped = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.kb-dash-2col > *')) as HTMLElement[];
    const bad: string[] = [];
    for (const card of cards) {
      const cr = card.getBoundingClientRect();
      for (const img of Array.from(card.querySelectorAll('img')) as HTMLImageElement[]) {
        const r = img.getBoundingClientRect();
        if (r.right > cr.right + 1 || r.left < cr.left - 1) bad.push(img.alt || '?');
      }
    }
    return bad;
  });
  expect(clipped, `clipped card art at 1120px: ${clipped.join(', ')}`).toEqual([]);
});
