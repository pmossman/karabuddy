import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, uploadReplay, claimInstallToken } from './helpers';

// B62: team page is now tabbed — Discussion (default) | Replays |
// Members | Settings. Each tab's data is server-rendered or
// client-fetched independently so we don't pay for tabs we're not on.

test('team page has 4 tabs in the expected order', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Tabber', email: 'tabber@example.com' });
  const { slug } = await createTeam(page, 'Tabs Team');
  await page.goto(`/teams/${slug}`);

  const tabBar = page.getByRole('tablist');
  await expect(tabBar.getByRole('tab', { name: /Discussion/i })).toBeVisible();
  await expect(tabBar.getByRole('tab', { name: /Replays/i })).toBeVisible();
  await expect(tabBar.getByRole('tab', { name: /Members/i })).toBeVisible();
  await expect(tabBar.getByRole('tab', { name: /Settings/i })).toBeVisible();
});

test('Discussion is the default tab', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Default', email: 'def@example.com' });
  const { slug } = await createTeam(page, 'Default Team');
  await page.goto(`/teams/${slug}`);

  // Discussion is aria-selected; the Discussion empty state is what
  // renders for a brand-new team.
  await expect(page.getByRole('tab', { name: /Discussion/i, selected: true })).toBeVisible();
  await expect(page.getByText(/No discussion yet/i)).toBeVisible();
  // Member-list-only chip ("Owner") is on a different tab, not here.
  await expect(page.getByText('Owner', { exact: true })).toHaveCount(0);
});

test('clicking Replays tab navigates + shows the inventory', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'RepTab', email: 'rt@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Rep Tab Team');
  const r = await uploadReplay(request, { local: { username: 'RepTab' }, opponent: { username: 'OppT' } });
  await claimInstallToken(page, r.installToken);
  await page.request.post(`/api/replays/${r.slug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': r.installToken },
  });

  await page.goto(`/teams/${teamSlug}`);
  await page.getByRole('tab', { name: /Replays/i }).click();

  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('replays');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByText('OppT')).toBeVisible();
});

test('clicking Members tab shows the member list', async ({ page }) => {
  await signInAsTestUser(page, { name: 'MemTab', email: 'mt@example.com' });
  const { slug } = await createTeam(page, 'Mem Tab Team');
  await page.goto(`/teams/${slug}`);

  await page.getByRole('tab', { name: /Members/i }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('members');
  await expect(page.getByText('MemTab')).toBeVisible();
  // The "Owner" role chip is a strong member-list signal.
  await expect(page.getByText('Owner', { exact: true })).toBeVisible();
});

test('Settings tab surfaces destructive controls (rename / leave)', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Setter', email: 'set@example.com' });
  const { slug } = await createTeam(page, 'Setter Team');
  await page.goto(`/teams/${slug}`);

  await page.getByRole('tab', { name: /Settings/i }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('settings');
  // Existing TeamControls renders a Rename + Leave-team button.
  await expect(page.getByRole('button', { name: /Leave team/i })).toBeVisible();
});

test('deep-link ?tab=members lands on Members tab', async ({ page }) => {
  await signInAsTestUser(page, { name: 'DeepTab', email: 'dt@example.com' });
  const { slug } = await createTeam(page, 'Deep Tab Team');
  await page.goto(`/teams/${slug}?tab=members`);

  await expect(page.getByRole('tab', { name: /Members/i, selected: true })).toBeVisible();
  await expect(page.getByText('DeepTab')).toBeVisible();
});
