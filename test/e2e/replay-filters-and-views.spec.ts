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

test('view switcher: by-leader lists leaders + counts, tap drills into replays', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'GroupBy', email: 'groupby@example.com' });
  const r1 = await uploadReplay(request, {
    local: { username: 'GroupBy', leaderName: 'Luke Skywalker' },
    opponent: { username: 'X' },
  });
  await claimInstallToken(page, r1.installToken);

  await page.goto('/replays?tab=mine&view=by-leader');
  // B123-followup: collapsed leader rows (name + count); the replays live behind
  // a tap, not pre-expanded.
  const leaderRow = page.getByTestId('leader-group-heading').first();
  await expect(leaderRow).toContainText(/Luke Skywalker/);
  await expect(leaderRow).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(`a[href="/r/${r1.slug}"]`)).toHaveCount(0); // collapsed → hidden

  await leaderRow.click();
  await expect(leaderRow).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`a[href="/r/${r1.slug}"]`).first()).toBeVisible(); // drilled in
});

test('view switcher: timeline lists day rows + counts, tap drills into replays', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Timeliner', email: 'tl@example.com' });
  const r1 = await uploadReplay(request, {
    local: { username: 'Timeliner' },
    opponent: { username: 'X' },
  });
  await claimInstallToken(page, r1.installToken);

  await page.goto('/replays?tab=mine&view=timeline');
  // B123-followup: same drill-down as by-leader — collapsed day rows, replays
  // behind a tap.
  const dayRow = page.getByTestId('timeline-day-heading').first();
  await expect(dayRow).toBeVisible();
  await expect(dayRow).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(`a[href="/r/${r1.slug}"]`)).toHaveCount(0);

  await dayRow.click();
  await expect(dayRow).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`a[href="/r/${r1.slug}"]`).first()).toBeVisible();
});

test('timeline calendar: a populated day cell shows a count + opens that day', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'CalUser', email: 'cal@example.com' });
  const r1 = await uploadReplay(request, { local: { username: 'CalUser' }, opponent: { username: 'X' } });
  await claimInstallToken(page, r1.installToken);

  await page.goto('/replays?tab=mine&view=timeline');
  // B123-followup: the calendar is collapsed behind a Calendar toggle by default.
  await expect(page.getByTestId('calendar-day')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show calendar' }).click();

  const cell = page.getByTestId('calendar-day').first();
  await expect(cell).toBeVisible();
  await expect(cell).toContainText('1'); // the day's replay count
  await expect(page.locator(`a[href="/r/${r1.slug}"]`)).toHaveCount(0); // list still collapsed

  await cell.click();
  await expect(page.locator(`a[href="/r/${r1.slug}"]`).first()).toBeVisible();
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

// -- B117: All-replays hub — My replays + per-team tabs in one place --

test('hub shows a My replays tab + a tab per team (linking into the hub)', async ({ page }) => {
  await signInAsTestUser(page, { name: 'TeamJumper', email: 'tj@example.com' });
  const { slug } = await createTeam(page, 'Jump Squad');
  await page.goto('/replays');
  await expect(page.getByRole('tab', { name: 'My replays' })).toHaveAttribute('aria-selected', 'true');
  const teamTab = page.getByRole('tab', { name: 'Jump Squad' });
  await expect(teamTab).toBeVisible();
  await expect(teamTab).toHaveAttribute('href', `/replays?team=${slug}`);
});

test('hub switches to a team\'s replays in place, then back to My replays', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'HubUser', email: 'hub@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Hub Team');
  const { slug: replaySlug, installToken } = await uploadReplay(request, {
    local: { username: 'HubUser', leaderName: 'Greef Karga' }, opponent: { username: 'Foe' },
  });
  await claimInstallToken(page, installToken);
  await page.request.post(`/api/replays/${replaySlug}/team-shares`, {
    data: { teamSlug }, headers: { 'X-Install-Token': installToken },
  });

  await page.goto('/replays');
  await page.getByRole('tab', { name: 'Hub Team' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('team')).toBe(teamSlug);
  await expect(page.getByRole('tab', { name: 'Hub Team' })).toHaveAttribute('aria-selected', 'true');
  // The team-only "Uploaded by" filter is available on a team tab.
  await page.getByRole('button', { name: 'Filters' }).click();
  await expect(page.getByLabel('Uploaded by')).toBeVisible();

  // One click back to My replays.
  await page.getByRole('tab', { name: 'My replays' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('team')).toBeNull();
});

test('an unknown ?team falls back to My replays', async ({ page }) => {
  await signInAsTestUser(page, { name: 'BogusTeam', email: 'bt@example.com' });
  await page.goto('/replays?team=does-not-exist');
  await expect(page.getByRole('tab', { name: 'My replays' })).toHaveAttribute('aria-selected', 'true');
});

// -- B116: leader filters (my leader / opponent leader), opponent-username gone --

test('filters are by leader, not opponent username', async ({ page }) => {
  await signInAsTestUser(page, { name: 'LeadFilt', email: 'lf@example.com' });
  await page.goto('/replays?tab=mine');
  await page.getByRole('button', { name: 'Filters' }).click(); // filters collapsed by default
  await expect(page.getByLabel('My leader')).toBeVisible();
  await expect(page.getByLabel('Opponent leader')).toBeVisible();
  // The old opponent-username filter is gone entirely.
  await expect(page.getByLabel('Opponent (username)')).toHaveCount(0);
});

test('My leader / Opponent leader filters narrow the list', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'LeadNarrow', email: 'ln@example.com' });
  // Two games: I play Greef vs Krennic, then Boba vs Krennic.
  for (const mine of ['Greef Karga', 'Boba Fett']) {
    const r = await uploadReplay(request, {
      local: { username: 'LeadNarrow', leaderName: mine },
      opponent: { username: 'Foe', leaderName: 'Director Krennic' },
    });
    await claimInstallToken(page, r.installToken);
  }
  // My leader = Greef → only the Greef game survives.
  await page.goto('/replays?tab=mine&mine=' + encodeURIComponent('Greef Karga'));
  await expect(page.getByTestId('replay-cell')).toHaveCount(1);
  await expect(page.getByTestId('replay-cell').first()).toContainText('Greef Karga');
  // Opponent leader = Director Krennic → both survive (shared opponent).
  await page.goto('/replays?tab=mine&vs=' + encodeURIComponent('Director Krennic'));
  await expect(page.getByTestId('replay-cell')).toHaveCount(2);
});

// -- B116: Bo3 series grouping (same lobbyId → one series block) --

test('Bo3 games sharing a lobby render as a single series group', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Bo3er', email: 'bo3@example.com' });
  const lobbyId = 'lobby-' + Date.now();
  for (let i = 0; i < 2; i++) {
    const r = await uploadReplay(request, {
      local: { username: 'Bo3er' },
      opponent: { username: 'Rival' },
      match: { gamesToWinMode: 'bestOfThree', lobbyId },
    });
    await claimInstallToken(page, r.installToken);
  }
  // A standalone game (its own lobby) stays a singleton.
  const solo = await uploadReplay(request, { local: { username: 'Bo3er' }, opponent: { username: 'Solo' }, match: { lobbyId: 'lobby-solo-' + Date.now() } });
  await claimInstallToken(page, solo.installToken);

  await page.goto('/replays?tab=mine');
  await expect(page.getByTestId('series-group')).toHaveCount(1);
  // B158: the label comes from the FORMAT (Bo3), not the 2 games recorded.
  await expect(page.getByTestId('series-group').first()).toContainText(/Best of 3/);
});

// -- B158: a persistent lobby with several matches splits into separate series --

test('multiple Bo3 matches in one lobby split into separate series groups', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Grinder', email: 'grinder@example.com' });
  const lobbyId = 'lobby-multi-' + Date.now();
  // Four games, all won by the viewer → two 2-0 Bo3 matches in the same lobby.
  for (let i = 0; i < 4; i++) {
    const r = await uploadReplay(request, {
      local: { username: 'Grinder' },
      opponent: { username: 'Rival' },
      match: { gamesToWinMode: 'bestOfThree', lobbyId },
      winners: ['Grinder'],
    });
    await claimInstallToken(page, r.installToken);
  }
  await page.goto('/replays?tab=mine');
  // Segments into two matches (2-0, 2-0), not one "Best of 4".
  await expect(page.getByTestId('series-group')).toHaveCount(2);
  await expect(page.getByTestId('series-group').first()).toContainText(/Best of 3/);
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

test('view switcher labels: Replays / By leader / Timeline', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Labels', email: 'labels@example.com' });
  await page.goto('/replays?tab=mine');
  // B123-followup: Table + Grid merged into one adaptive "Replays" view.
  await expect(page.getByRole('button', { name: 'Replays' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Grid' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'By leader' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Timeline' })).toBeVisible();
});

test('legacy ?view=grid resolves to the adaptive Replays view (table on desktop)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'LegacyGrid', email: 'lg@example.com' });
  const r = await uploadReplay(request, { local: { username: 'LegacyGrid' }, opponent: { username: 'Opp' } });
  await claimInstallToken(page, r.installToken);
  await page.goto('/replays?tab=mine&view=grid');
  // Maps to the default 'replays' view → on desktop that's the table.
  await expect(page.getByRole('table')).toBeVisible();
});

test('table: clicking a sortable column header reorders rows', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Sorter', email: 'sort@example.com' });
  // B116: the Replay column now sorts by the leader matchup, so vary the leader.
  for (const lead of ['Charlie Leader', 'Alpha Leader', 'Bravo Leader']) {
    const r = await uploadReplay(request, { local: { username: 'Sorter', leaderName: lead }, opponent: { username: 'Foe' } });
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

test('B159: team replays can be grouped by member (team grid only)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'GroupOwner', email: 'go159@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Group Team');
  const { slug: replaySlug, installToken } = await uploadReplay(request, {
    local: { username: 'GroupOwner' }, opponent: { username: 'Opp' },
  });
  await claimInstallToken(page, installToken);
  await page.request.post(`/api/replays/${replaySlug}/team-shares`, {
    data: { teamSlug }, headers: { 'X-Install-Token': installToken },
  });

  await page.goto(`/teams/${teamSlug}?tab=replays`);
  const byMember = page.getByRole('button', { name: 'By member' });
  await expect(byMember).toBeVisible();
  await byMember.click();
  await expect(page.getByTestId('member-group-heading').filter({ hasText: 'GroupOwner' })).toBeVisible();
});

test('B159: "By member" is hidden on the personal library', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'SoloUser', email: 'solo159@example.com' });
  const { installToken } = await uploadReplay(request, { local: { username: 'SoloUser' }, opponent: { username: 'Opp' } });
  await claimInstallToken(page, installToken);
  await page.goto('/replays?tab=mine');
  await expect(page.getByRole('button', { name: 'By leader' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'By member' })).toHaveCount(0);
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
  // The leader filter controls render on the team page too — plus the team-only
  // "Uploaded by" member filter (B116).
  await expect(page.getByLabel('My leader')).toBeVisible();
  await expect(page.getByLabel('Opponent leader')).toBeVisible();
  await expect(page.getByLabel('Uploaded by')).toBeVisible();
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
