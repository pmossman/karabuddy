import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, uploadReplay, claimInstallToken } from './helpers';

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
