import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, generateInvite, uploadReplay, claimInstallToken } from './helpers';

// Team-centric revamp: the in-page tab bar is gone — the team's sections are
// navigated from the left sidebar, and each section is a `?tab=X` view on
// /teams/<slug> (the default, ?tab=overview, is the dashboard). These cover the
// section views rendering + deep-linking; the sidebar nav itself is exercised
// via the links.

test('team sections are reachable from the sidebar nav', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Navver', email: 'navver@example.com' });
  const { slug } = await createTeam(page, 'Nav Team');
  await page.goto(`/teams/${slug}`);

  // The sidebar TEAM group links to each section.
  for (const name of ['Dashboard', 'Discussion', 'Replays', 'Reviews', 'Tournaments', 'Members']) {
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  }
});

test('the default view is the dashboard (overview), not discussion', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Default', email: 'def@example.com' });
  const { slug } = await createTeam(page, 'Default Team');
  await page.goto(`/teams/${slug}`);

  // The dashboard hub renders its feature cards; Discussion is a separate view.
  await expect(page.getByRole('main').getByText(/Team replays/i)).toBeVisible();
  await page.goto(`/teams/${slug}?tab=discussion`);
  await expect(page.getByText(/No discussion yet/i)).toBeVisible();
});

test('Replays section shows the team inventory', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'RepTab', email: 'rt@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Rep Tab Team');
  const r = await uploadReplay(request, { local: { username: 'RepTab' }, opponent: { username: 'OppT' } });
  await claimInstallToken(page, r.installToken);
  await page.request.post(`/api/replays/${r.slug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': r.installToken },
  });

  await page.goto(`/teams/${teamSlug}?tab=replays`);
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('main').getByText('OppT')).toBeVisible();
});

test('Members section shows the member list', async ({ page }) => {
  await signInAsTestUser(page, { name: 'MemTab', email: 'mt@example.com' });
  const { slug } = await createTeam(page, 'Mem Tab Team');
  await page.goto(`/teams/${slug}?tab=members`);

  await expect(page.getByRole('main').getByText('MemTab')).toBeVisible();
  await expect(page.getByRole('main').getByText('Owner', { exact: true })).toBeVisible();
});

test('Settings section surfaces destructive controls (rename / leave)', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Setter', email: 'set@example.com' });
  const { slug } = await createTeam(page, 'Setter Team');
  await page.goto(`/teams/${slug}?tab=settings`);

  await expect(page.getByRole('button', { name: /Leave team/i })).toBeVisible();
});

// B160: an owner transfers the team to another member from Settings (and steps
// down to a regular member). The per-row "Make owner" button was replaced by a
// deliberate Settings flow with a confirmation.
test('owner transfers ownership from Settings and steps down', async ({ page, browser }) => {
  await signInAsTestUser(page, { name: 'OwnerA', email: 'ownera-xfer@example.com' });
  const { slug } = await createTeam(page, 'Transfer Team');
  const { code } = await generateInvite(page, slug);

  // A second member joins via the invite.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await signInAsTestUser(pageB, { name: 'MemberB', email: 'memberb-xfer@example.com' });
  const join = await pageB.request.post('/api/teams/join', { data: { code } });
  expect(join.ok()).toBeTruthy();

  // A: on a solo team there'd be no transfer section; with B present it shows.
  await page.goto(`/teams/${slug}?tab=settings`);
  await expect(page.getByTestId('transfer-target')).toBeVisible();
  await page.getByTestId('transfer-target').selectOption({ label: 'MemberB' });
  await page.getByTestId('transfer-open').click();
  await page.getByTestId('transfer-confirm').click();

  // A has stepped down — the owner-only transfer control is gone.
  await expect(page.getByTestId('transfer-target')).toHaveCount(0);

  // B is now the owner — they see the transfer control on their Settings.
  await pageB.goto(`/teams/${slug}?tab=settings`);
  await expect(pageB.getByTestId('transfer-target')).toBeVisible();
  await ctxB.close();
});
