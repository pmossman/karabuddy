import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers';

// B101: /stats is scoped to the signed-in user + their teams — NO global/
// community view. Signed out, it prompts sign-in; signed in, it shows the
// scope switcher (Mine, no Global) and the view tabs.
// /stats is the personal "My Stats" surface (team stats live in the team page).
// No scope switcher, no global/community view.
test('My Stats prompts sign-in when signed out — no global view', async ({ page }) => {
  await page.goto('/stats');
  await expect(page.getByRole('heading', { name: /My\s*Stats/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/sign in to see your personal stats/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Global' })).toHaveCount(0);
});

test('signed in, My Stats shows the personal surface + view tabs (no global)', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Stats Tester' });
  await page.goto('/stats');
  await expect(page.getByRole('heading', { name: /My\s*Stats/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Global' })).toHaveCount(0);
  for (const tab of ['Leaders', 'Matchups', 'Cards', 'Resourcing']) {
    await expect(page.getByRole('button', { name: tab })).toBeVisible();
  }
  // Matchups view's lens (leader-vs-leader / deck-vs-deck) now lives behind the Filters panel.
  await page.getByRole('button', { name: 'Matchups' }).click();
  await page.getByRole('button', { name: /^Filters/ }).click();
  await expect(page.getByRole('button', { name: 'Leaders & Bases' })).toBeVisible();
});

test('signed in, secondary controls collapse behind one Filters toggle (mobile-first)', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Controls Tester' });
  await page.goto('/stats');
  await expect(page.getByRole('heading', { name: /My\s*Stats/i })).toBeVisible({ timeout: 15000 });
  // Leaders view: the secondary controls are hidden until you open Filters.
  await expect(page.getByRole('button', { name: 'By leader + base' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Filters/ }).click();
  // Opened → the group toggle + the min-games + stepper appear.
  await expect(page.getByRole('button', { name: 'By leader + base' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More minimum games' })).toBeVisible();
});

test('Stats appears in the header nav', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Stats' })).toBeVisible();
});

// A custom day range is the viewer's calendar days: the stats fetch carries the
// browser's zone so the server reads "Oct 6" as LOCAL Oct 6 (it used UTC, which
// dropped US-evening games). Presets stay zone-free (one shared cache entry).
test.describe('date filter sends the viewer\'s time zone', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('a custom day range carries tz; a preset does not', async ({ page }) => {
    await signInAsTestUser(page, { name: 'TZ Tester' });
    await page.goto('/stats');
    await expect(page.getByRole('heading', { name: /My\s*Stats/i })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /^Filters/ }).click();

    const isLeaders = (u: URL) => u.pathname === '/api/stats' && u.searchParams.get('type') === 'leaders';
    await page.getByTestId('stats-filter-date').click();
    const preset = page.waitForRequest((r) => { const u = new URL(r.url()); return isLeaders(u) && u.searchParams.get('range') === '7d'; });
    await page.getByRole('button', { name: 'Past 7 days' }).click();
    expect(new URL((await preset).url()).searchParams.get('tz')).toBeNull();

    await page.getByTestId('stats-filter-date').click();
    await page.getByTestId('stats-filter-date-from').fill('2026-10-06');
    await page.getByTestId('stats-filter-date-to').fill('2026-10-06');
    const custom = page.waitForRequest((r) => { const u = new URL(r.url()); return isLeaders(u) && u.searchParams.get('range') === '2026-10-06..2026-10-06'; });
    await page.getByTestId('stats-filter-date-apply').click();
    expect(new URL((await custom).url()).searchParams.get('tz')).toBe('America/Los_Angeles');
  });
});
