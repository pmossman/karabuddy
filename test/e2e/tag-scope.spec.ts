import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, uploadReplay, claimInstallToken, generateInvite } from './helpers';

// B71: per-team comment scoping. A tag is visible only to the teams in
// its scope (subset of the replay's shares); empty scope = personal.
// This replaces the old "surfaces to every team the author belongs to"
// rule that leaked one team's comments into the author's other teams.

async function discussion(page: any, teamSlug: string) {
  const res = await page.request.get(`/api/teams/${teamSlug}/discussion`);
  const body = await res.json();
  if (!body.ok) throw new Error(`discussion ${teamSlug}: ${body.error}`);
  return body.data as any[];
}

function comments(items: any[]): string[] {
  return items.map((i) => i.latestTag?.comment).filter(Boolean);
}

test('member-tagged but unshared replay does NOT leak into the author\'s teams (the bug)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Leaker', email: 'leak@example.com' });
  const { slug: teamA } = await createTeam(page, 'Alpha');
  const { slug: teamB } = await createTeam(page, 'Bravo');

  // Author is a member of BOTH teams. They tag a replay with no scope and
  // no explicit share — under the old rule this surfaced to both teams.
  const r = await uploadReplay(request, { local: { username: 'Leaker' }, opponent: { username: 'Foe' } });
  await claimInstallToken(page, r.installToken);
  await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'Leaker', frameIndex: 0, comment: 'private musing' },
  });

  expect(comments(await discussion(page, teamA))).not.toContain('private musing');
  expect(comments(await discussion(page, teamB))).not.toContain('private musing');
});

test('explicit narrow: comment scoped to one shared team is hidden from the other', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Narrower', email: 'narrow@example.com' });
  const { slug: teamA } = await createTeam(page, 'Alpha2');
  const { slug: teamB } = await createTeam(page, 'Bravo2');

  const r = await uploadReplay(request, { local: { username: 'Narrower' }, opponent: { username: 'Foe' } });
  await claimInstallToken(page, r.installToken);
  // Replay shared with BOTH teams...
  for (const teamSlug of [teamA, teamB]) {
    await page.request.post(`/api/replays/${r.slug}/team-shares`, {
      data: { teamSlug }, headers: { 'X-Install-Token': r.installToken },
    });
  }
  // ...but this comment scoped to Alpha2 only.
  await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'Narrower', frameIndex: 0, comment: 'alpha eyes only', teamSlugs: [teamA] },
  });

  expect(comments(await discussion(page, teamA))).toContain('alpha eyes only');
  expect(comments(await discussion(page, teamB))).not.toContain('alpha eyes only');
});

test('default scope: an unscoped comment goes to the teams the replay is shared with', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Defaulter', email: 'default@example.com' });
  const { slug: teamA } = await createTeam(page, 'Alpha3');

  const r = await uploadReplay(request, { local: { username: 'Defaulter' }, opponent: { username: 'Foe' } });
  await claimInstallToken(page, r.installToken);
  await page.request.post(`/api/replays/${r.slug}/team-shares`, {
    data: { teamSlug: teamA }, headers: { 'X-Install-Token': r.installToken },
  });
  // No teamSlugs on the tag → defaults to the replay's shares (Alpha3).
  await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'Defaulter', frameIndex: 0, comment: 'shared by default' },
  });

  expect(comments(await discussion(page, teamA))).toContain('shared by default');
});

// --- Viewer sidebar scoping: GET /api/replays/[slug]/tags returns only
// tags the viewer may see (own, or scoped to a team they're in). B71.

test('viewer tag fetch scopes by team membership and authorship', async ({ page, browser, request }) => {
  await signInAsTestUser(page, { name: 'OwnerV', email: 'ownerv@example.com' });
  const { slug: teamA } = await createTeam(page, 'View Alpha');
  const { slug: teamB } = await createTeam(page, 'View Bravo');
  const { code: codeA } = await generateInvite(page, teamA);
  const { code: codeB } = await generateInvite(page, teamB);

  const r = await uploadReplay(request, { local: { username: 'OwnerV' }, opponent: { username: 'Foe' } });
  await claimInstallToken(page, r.installToken);
  for (const teamSlug of [teamA, teamB]) {
    await page.request.post(`/api/replays/${r.slug}/team-shares`, {
      data: { teamSlug }, headers: { 'X-Install-Token': r.installToken },
    });
  }
  // Owner (member of both) writes one comment per audience.
  const tag = (comment: string, teamSlugs?: string[]) =>
    page.request.post(`/api/replays/${r.slug}/tags`, {
      data: { installToken: r.installToken, authorName: 'OwnerV', frameIndex: 0, comment, ...(teamSlugs ? { teamSlugs } : { teamSlugs: undefined }) },
    });
  await tag('alpha only', [teamA]);
  await tag('bravo only', [teamB]);
  await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'OwnerV', frameIndex: 0, comment: 'my private note', teamSlugs: [] },
  });

  const fetchComments = async (p: any) => {
    const res = await p.request.get(`/api/replays/${r.slug}/tags`);
    const body = await res.json();
    return (body.data as any[]).map((t) => t.comment);
  };

  // Amy is in Alpha only.
  const ctxAmy = await browser.newContext();
  const amy = await ctxAmy.newPage();
  await signInAsTestUser(amy, { name: 'Amy', email: 'amy@example.com' });
  await amy.request.post('/api/teams/join', { data: { code: codeA } });

  // Bob is in Bravo only.
  const ctxBob = await browser.newContext();
  const bob = await ctxBob.newPage();
  await signInAsTestUser(bob, { name: 'Bob', email: 'bob@example.com' });
  await bob.request.post('/api/teams/join', { data: { code: codeB } });

  const amyComments = await fetchComments(amy);
  expect(amyComments).toContain('alpha only');
  expect(amyComments).not.toContain('bravo only');
  expect(amyComments).not.toContain('my private note');

  const bobComments = await fetchComments(bob);
  expect(bobComments).toContain('bravo only');
  expect(bobComments).not.toContain('alpha only');
  expect(bobComments).not.toContain('my private note');

  // Owner authored all three → sees all three.
  const ownerComments = await fetchComments(page);
  expect(ownerComments).toEqual(expect.arrayContaining(['alpha only', 'bravo only', 'my private note']));

  await ctxAmy.close();
  await ctxBob.close();
});

// --- Mentions inbox scoping: a mention can't notify someone outside the
// comment's team scope, even if the tag's mentions list is inconsistent. B71.

test('mentions inbox respects scope — off-scope team-mention does not leak', async ({ page, browser, request }) => {
  await signInAsTestUser(page, { name: 'OwnerM', email: 'ownerm@example.com' });
  const { slug: teamA } = await createTeam(page, 'Inbox Alpha');
  const { slug: teamB } = await createTeam(page, 'Inbox Bravo');
  const { code: codeB } = await generateInvite(page, teamB);

  const r = await uploadReplay(request, { local: { username: 'OwnerM' }, opponent: { username: 'Foe' } });
  await claimInstallToken(page, r.installToken);
  for (const teamSlug of [teamA, teamB]) {
    await page.request.post(`/api/replays/${r.slug}/team-shares`, {
      data: { teamSlug }, headers: { 'X-Install-Token': r.installToken },
    });
  }
  // Comment scoped to Alpha only, but (inconsistently) team-mentioning Bravo.
  await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: {
      installToken: r.installToken, authorName: 'OwnerM', frameIndex: 0,
      comment: 'alpha-scoped but mentions bravo', teamSlugs: [teamA],
      mentions: { userIds: [], teamSlugs: [teamB] },
    },
  });

  // A Bravo-only member must NOT see it in their inbox (not in Alpha scope).
  const ctxBob = await browser.newContext();
  const bob = await ctxBob.newPage();
  await signInAsTestUser(bob, { name: 'BobM', email: 'bobm@example.com' });
  await bob.request.post('/api/teams/join', { data: { code: codeB } });

  const res = await bob.request.get('/api/me/mentions');
  const body = await res.json();
  const comments = (body.data as any[]).map((t) => t.comment);
  expect(comments).not.toContain('alpha-scoped but mentions bravo');

  await ctxBob.close();
});
