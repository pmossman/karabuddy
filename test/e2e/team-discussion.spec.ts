import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, generateInvite, uploadReplay, claimInstallToken } from './helpers';

// B61: team page Discussion feed — a second section above the existing
// Replays inventory that surfaces replays with active tag discussion.

// B62 split the page into tabs; the "Discussion above Replays" layout
// invariant from B61 is obsolete. team-tabs.spec.ts covers Discussion
// being the default tab + the tab ordering instead.

test('empty discussion: friendly empty state when no team replays have tags', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'EmptyDisc', email: 'ed@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Empty Disc Team');
  // Share a replay into the team (so it's surfaced) but DON'T tag it.
  const r = await uploadReplay(request, { local: { username: 'EmptyDisc' }, opponent: { username: 'X' } });
  await claimInstallToken(page, r.installToken);
  await page.request.post(`/api/replays/${r.slug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': r.installToken },
  });

  await page.goto(`/teams/${teamSlug}?tab=discussion`);
  await expect(page.getByText(/No discussion yet/i)).toBeVisible();
});

test('discussion item surfaces with latest comment + author byline', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'CommenterA', email: 'ca@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Active Team');
  const r = await uploadReplay(request, { local: { username: 'CommenterA' }, opponent: { username: 'Opp' } });
  await claimInstallToken(page, r.installToken);
  await page.request.post(`/api/replays/${r.slug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': r.installToken },
  });

  // Two tags by the same author — the LATEST should surface as the preview.
  await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'CommenterA', frameIndex: 0, comment: 'first comment' },
  });
  await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'CommenterA', frameIndex: 0, comment: 'most recent comment' },
  });

  await page.goto(`/teams/${teamSlug}?tab=discussion`);
  const item = page.getByTestId('discussion-item').first();
  await expect(item).toBeVisible();
  await expect(item).toContainText('most recent comment');
  await expect(item).toContainText('CommenterA');
});

test('replays without tags do not appear in Discussion', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'MixedActivity', email: 'ma@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Mixed Team');

  // Tagged replay
  const tagged = await uploadReplay(request, { local: { username: 'MixedActivity' }, opponent: { username: 'TagOpp' } });
  await claimInstallToken(page, tagged.installToken);
  await page.request.post(`/api/replays/${tagged.slug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': tagged.installToken },
  });
  await page.request.post(`/api/replays/${tagged.slug}/tags`, {
    data: { installToken: tagged.installToken, authorName: 'MixedActivity', frameIndex: 0, comment: 'discuss this' },
  });

  // Untagged replay also shared with the team
  const quiet = await uploadReplay(request, { local: { username: 'MixedActivity' }, opponent: { username: 'QuietOpp' } });
  await claimInstallToken(page, quiet.installToken);
  await page.request.post(`/api/replays/${quiet.slug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': quiet.installToken },
  });

  await page.goto(`/teams/${teamSlug}?tab=discussion`);
  const discItems = page.getByTestId('discussion-item');
  await expect(discItems).toHaveCount(1);
  // The tagged replay is the one that shows up in Discussion.
  await expect(discItems.first()).toContainText('TagOpp');
});

test('clicking a discussion item navigates to the replay at the latest tagged frame', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Clicker', email: 'cl@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Click Team');
  const r = await uploadReplay(request, { local: { username: 'Clicker' }, opponent: { username: 'Op' } });
  await claimInstallToken(page, r.installToken);
  await page.request.post(`/api/replays/${r.slug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': r.installToken },
  });
  await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'Clicker', frameIndex: 0, comment: 'jump here' },
  });

  await page.goto(`/teams/${teamSlug}?tab=discussion`);
  await page.getByTestId('discussion-item').first().click();
  // Frame is 1-based in the URL (B48: ?f=N where N starts at 1).
  await page.waitForURL(new RegExp(`/r/${r.slug}\\?f=1`));
});

test('participant bubbles render one per unique tag author', async ({ page, request, browser }) => {
  // Owner A creates team + invites B, both tag the same replay.
  await signInAsTestUser(page, { name: 'AuthorA', email: 'aa@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Bubble Team');
  const { code } = await generateInvite(page, teamSlug);

  const r = await uploadReplay(request, { local: { username: 'AuthorA' }, opponent: { username: 'OppZ' } });
  await claimInstallToken(page, r.installToken);
  await page.request.post(`/api/replays/${r.slug}/team-shares`, {
    data: { teamSlug },
    headers: { 'X-Install-Token': r.installToken },
  });
  await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'AuthorA', frameIndex: 0, comment: 'A says hi' },
  });

  // B joins and tags as well.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await signInAsTestUser(pageB, { name: 'AuthorB', email: 'ab@example.com' });
  await pageB.request.post('/api/teams/join', { data: { code } });
  await pageB.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: 'kbx_authorb_install', authorName: 'AuthorB', frameIndex: 0, comment: 'B says hi' },
  });

  await page.goto(`/teams/${teamSlug}?tab=discussion`);
  const item = page.getByTestId('discussion-item').first();
  // Two distinct authors → two participant bubbles.
  await expect(item.getByTestId('participant-bubble')).toHaveCount(2);

  await ctxB.close();
});

test('discussion items ordered by latest-tag DESC', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Orderer', email: 'or@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Order Team');

  // Two replays, both tagged.
  const older = await uploadReplay(request, { local: { username: 'Orderer' }, opponent: { username: 'OldOpp' } });
  await claimInstallToken(page, older.installToken);
  await page.request.post(`/api/replays/${older.slug}/team-shares`, {
    data: { teamSlug }, headers: { 'X-Install-Token': older.installToken },
  });
  await page.request.post(`/api/replays/${older.slug}/tags`, {
    data: { installToken: older.installToken, authorName: 'Orderer', frameIndex: 0, comment: 'older' },
  });

  const newer = await uploadReplay(request, { local: { username: 'Orderer' }, opponent: { username: 'NewOpp' } });
  await claimInstallToken(page, newer.installToken);
  await page.request.post(`/api/replays/${newer.slug}/team-shares`, {
    data: { teamSlug }, headers: { 'X-Install-Token': newer.installToken },
  });
  await page.request.post(`/api/replays/${newer.slug}/tags`, {
    data: { installToken: newer.installToken, authorName: 'Orderer', frameIndex: 0, comment: 'newer' },
  });

  await page.goto(`/teams/${teamSlug}?tab=discussion`);
  const items = page.getByTestId('discussion-item');
  await expect(items).toHaveCount(2);
  // NewOpp's replay was tagged more recently → must be first.
  await expect(items.nth(0)).toContainText('NewOpp');
  await expect(items.nth(1)).toContainText('OldOpp');
});
