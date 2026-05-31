import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, uploadReplay, claimInstallToken } from './helpers';

// B52-followup: URL persistence + view switcher (card / by-leader / timeline)
// + cohesion with /teams/[slug] team-replays browsing.

// -- URL persistence --

test('filter selection writes to URL search params', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'UrlSyncer', email: 'urlsync@example.com' });
  const r1 = await uploadReplay(request, {
    local: { username: 'UrlSyncer' },
    opponent: { username: 'A' },
  });
  await claimInstallToken(page, r1.installToken);
  await page.request.patch(`/api/replays/${r1.slug}`, {
    data: { labels: ['tournament'] },
    headers: { 'X-Install-Token': r1.installToken },
  });

  await page.goto('/replays?tab=mine');
  await page.getByRole('button', { name: 'Filters' }).click(); // filters collapsed by default
  await page.getByLabel('Label').selectOption('tournament');

  // URL should now carry the label param (keeping tab=mine).
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('tournament');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('mine');
});

test('URL search params hydrate filter state on load (deep-link share)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'DeepLinker', email: 'deeplink@example.com' });
  const r1 = await uploadReplay(request, {
    local: { username: 'DeepLinker' },
    opponent: { username: 'A' },
  });
  await claimInstallToken(page, r1.installToken);
  await page.request.patch(`/api/replays/${r1.slug}`, {
    data: { labels: ['tournament'] },
    headers: { 'X-Install-Token': r1.installToken },
  });

  const r2 = await uploadReplay(request, {
    local: { username: 'DeepLinker' },
    opponent: { username: 'B' },
  });
  await claimInstallToken(page, r2.installToken);

  // Deep-link with label preset → only the tournament-labeled card renders.
  await page.goto('/replays?tab=mine&label=tournament');
  await expect(page.getByRole('link', { name: /DeepLinker vs A/ })).toHaveCount(1);
  await expect(page.getByRole('link', { name: /DeepLinker vs B/ })).toHaveCount(0);
  // The select should reflect the URL state.
  await expect(page.getByLabel('Label')).toHaveValue('tournament');
});

test('filter URL survives reload', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Reloader', email: 'reload@example.com' });
  const r1 = await uploadReplay(request, {
    local: { username: 'Reloader' },
    opponent: { username: 'A' },
  });
  await claimInstallToken(page, r1.installToken);
  await page.request.patch(`/api/replays/${r1.slug}`, {
    data: { labels: ['favorite'] },
    headers: { 'X-Install-Token': r1.installToken },
  });

  await page.goto('/replays?tab=mine');
  await page.getByRole('button', { name: 'Filters' }).click(); // filters collapsed by default
  await page.getByLabel('Label').selectOption('favorite');
  // router.replace is async — wait for the URL to reflect the selection
  // before reloading, otherwise the reload races the URL update.
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('favorite');
  await page.reload();
  await expect(page.getByLabel('Label')).toHaveValue('favorite');
});

// -- View switcher --

test('view switcher: by-leader groups replays under leader heading', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'GroupBy', email: 'groupby@example.com' });
  const r1 = await uploadReplay(request, {
    local: { username: 'GroupBy' },
    opponent: { username: 'X' },
  });
  await claimInstallToken(page, r1.installToken);

  await page.goto('/replays?tab=mine&view=by-leader');
  // The leader-section heading is data-tagged so it survives styling tweaks.
  await expect(page.getByTestId('leader-group-heading').first()).toContainText(/Luke Skywalker/);
});

test('view switcher: timeline groups replays under date heading', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Timeliner', email: 'tl@example.com' });
  const r1 = await uploadReplay(request, {
    local: { username: 'Timeliner' },
    opponent: { username: 'X' },
  });
  await claimInstallToken(page, r1.installToken);

  await page.goto('/replays?tab=mine&view=timeline');
  await expect(page.getByTestId('timeline-day-heading').first()).toBeVisible();
});

test('view switcher: clicking a view tab updates the URL', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Switcher', email: 'sw@example.com' });
  const r1 = await uploadReplay(request, {
    local: { username: 'Switcher' },
    opponent: { username: 'X' },
  });
  await claimInstallToken(page, r1.installToken);

  await page.goto('/replays?tab=mine');
  await page.getByRole('button', { name: 'By leader' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('by-leader');
});

// -- Opponent input: LastPass autofill suppression + datalist combobox --

test('opponent input is a search field + marked password-manager-ignore', async ({ page }) => {
  await signInAsTestUser(page, { name: 'LPx', email: 'lpx@example.com' });
  await page.goto('/replays?tab=mine');
  await page.getByRole('button', { name: 'Filters' }).click(); // filters collapsed by default
  const opp = page.getByLabel('Opponent (username)');
  // type=search is the real fix — password managers don't attach to search fields.
  await expect(opp).toHaveAttribute('type', 'search');
  await expect(opp).toHaveAttribute('data-lpignore', 'true');
  await expect(opp).toHaveAttribute('autocomplete', 'off');
  await expect(opp).toHaveAttribute('data-form-type', 'other');
});

test('opponent input is a combobox of seen opponent usernames', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'OppList', email: 'ol@example.com' });
  for (const opp of ['Alice', 'Bob']) {
    const r = await uploadReplay(request, { local: { username: 'OppList' }, opponent: { username: opp } });
    await claimInstallToken(page, r.installToken);
  }
  await page.goto('/replays?tab=mine');
  await page.getByRole('button', { name: 'Filters' }).click(); // filters collapsed by default
  const opp = page.getByLabel('Opponent (username)');
  const listId = await opp.getAttribute('list');
  expect(listId).toBeTruthy();
  const values = await page.locator(`#${listId} option`).evaluateAll(
    (els) => els.map((e) => (e as HTMLOptionElement).value)
  );
  expect(values).toEqual(expect.arrayContaining(['Alice', 'Bob']));
});

// -- Default view = table (renamed Cards → Grid), table is sortable --

test('default view is table with column headers', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Tabler', email: 'tabler@example.com' });
  const r = await uploadReplay(request, { local: { username: 'Tabler' }, opponent: { username: 'Opp1' } });
  await claimInstallToken(page, r.installToken);

  await page.goto('/replays?tab=mine');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Date/i })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Replay/i })).toBeVisible();
});

test('view switcher labels: Table / Grid / By leader / Timeline', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Labels', email: 'labels@example.com' });
  await page.goto('/replays?tab=mine');
  await expect(page.getByRole('button', { name: 'Table' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Grid' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'By leader' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Timeline' })).toBeVisible();
});

test('table: clicking a sortable column header reorders rows', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Sorter', email: 'sort@example.com' });
  for (const opp of ['Charlie', 'Alpha', 'Bravo']) {
    const r = await uploadReplay(request, { local: { username: 'Sorter' }, opponent: { username: opp } });
    await claimInstallToken(page, r.installToken);
  }
  await page.goto('/replays?tab=mine');

  // Click "Replay" header → sort matchups alphabetically (Alpha, Bravo, Charlie).
  await page.getByRole('columnheader', { name: /Replay/i }).click();
  const cells = await page.getByTestId('replay-cell').allTextContents();
  const idx = (needle: string) => cells.findIndex((c) => c.includes(needle));
  expect(idx('Alpha')).toBeGreaterThanOrEqual(0);
  expect(idx('Alpha')).toBeLessThan(idx('Bravo'));
  expect(idx('Bravo')).toBeLessThan(idx('Charlie'));
});

// -- Table view: leader/base thumbnails + Member column --

test('table: Replay cell contains leader + base thumbnails', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'ThumbView', email: 'thumb@example.com' });
  const r = await uploadReplay(request, {
    local: { username: 'ThumbView' },
    opponent: { username: 'OppZ' },
  });
  await claimInstallToken(page, r.installToken);
  await page.goto('/replays?tab=mine');
  // At-a-glance card art: each Replay cell renders at least one <img>.
  await expect(page.getByTestId('replay-cell').first().locator('img').first()).toBeVisible();
});

test('table: Member column surfaces replay-uploader display name', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'OwnerNamed', email: 'owner-named@example.com' });
  const r = await uploadReplay(request, {
    local: { username: 'OwnerNamed' },
    opponent: { username: 'X' },
  });
  await claimInstallToken(page, r.installToken);
  await page.goto('/replays?tab=mine');
  await expect(page.getByRole('columnheader', { name: /Member/i })).toBeVisible();
  await expect(page.getByTestId('member-cell').first()).toContainText('OwnerNamed');
});

test('table Member column visible on the team page too', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'TeamOwnerName', email: 'ton@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Member Col Team');
  const { slug: replaySlug, installToken } = await uploadReplay(request, {
    local: { username: 'TeamOwnerName' },
    opponent: { username: 'Opp' },
  });
  await claimInstallToken(page, installToken);
  await page.request.post(`/api/replays/${replaySlug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': installToken },
  });

  await page.goto(`/teams/${teamSlug}?tab=replays`);
  await expect(page.getByRole('columnheader', { name: /Member/i })).toBeVisible();
  await expect(page.getByTestId('member-cell').first()).toContainText('TeamOwnerName');
});

// -- Cohesion: team replays page shares the same filter UI + URL persistence --

test('team page renders the same filter controls', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'TeamFilterOwner', email: 'tfo@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Filter Team');
  const { slug: replaySlug, installToken } = await uploadReplay(request, {
    local: { username: 'TeamFilterOwner' },
    opponent: { username: 'OppA' },
  });
  await claimInstallToken(page, installToken);
  // Share into the team so it surfaces.
  await page.request.post(`/api/replays/${replaySlug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': installToken },
  });

  await page.goto(`/teams/${teamSlug}?tab=replays`);
  await page.getByRole('button', { name: 'Filters' }).click(); // filters collapsed by default
  // The Leader filter control should render on the team page too.
  await expect(page.getByLabel('Leader')).toBeVisible();
});

test('team page filter selection writes to URL', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'TeamUrlSync', email: 'tus@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'URL Sync Team');
  const { slug: replaySlug, installToken } = await uploadReplay(request, {
    local: { username: 'TeamUrlSync' },
    opponent: { username: 'OppA' },
  });
  await claimInstallToken(page, installToken);
  await page.request.patch(`/api/replays/${replaySlug}`, {
    data: { labels: ['scrim'] },
    headers: { 'X-Install-Token': installToken },
  });
  await page.request.post(`/api/replays/${replaySlug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': installToken },
  });

  await page.goto(`/teams/${teamSlug}?tab=replays`);
  await page.getByRole('button', { name: 'Filters' }).click(); // filters collapsed by default
  await page.getByLabel('Label').selectOption('scrim');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('scrim');
});
