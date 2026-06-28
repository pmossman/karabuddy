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

// --- Upload write-path: the extension's armed shareTeamSlugs create the
// replay's shares AND become the lifted in-game tags' scope. Per-tag
// teamSlugs narrows. B71.

test('upload applies armed shares and scopes lifted in-game tags', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Recorder', email: 'recorder@example.com' });
  const { slug: teamA } = await createTeam(page, 'Up Alpha');
  const { slug: teamB } = await createTeam(page, 'Up Bravo');

  // Both uploads arm teams A + B. Separate replays so each tag shows as its
  // own discussion item (the feed collapses to one latest-tag per replay).
  // Replay 1: a broadcast tag (no per-tag teamSlugs → defaults to the shares).
  await uploadReplay(page.request, {
    local: { username: 'Recorder' }, opponent: { username: 'Foe1' },
    shareTeamSlugs: [teamA, teamB],
    tags: [{ id: 'ig-broadcast', frameIndex: 0, author: 'Recorder', comment: 'broadcast note' }],
  });
  // Replay 2: a tag narrowed to Alpha even though the replay is shared with both.
  await uploadReplay(page.request, {
    local: { username: 'Recorder' }, opponent: { username: 'Foe2' },
    shareTeamSlugs: [teamA, teamB],
    tags: [{ id: 'ig-alpha', frameIndex: 0, author: 'Recorder', comment: 'alpha note', teamSlugs: [teamA] }],
  });

  const comments = async (slug: string) => {
    const res = await page.request.get(`/api/teams/${slug}/discussion`);
    const body = await res.json();
    return (body.data as any[]).map((i) => i.latestTag?.comment).filter(Boolean);
  };

  // Alpha sees both; Bravo sees only the broadcast (the armed shares were
  // applied by the upload, and the narrowed tag is withheld from Bravo).
  const a = await comments(teamA);
  const b = await comments(teamB);
  expect(a).toEqual(expect.arrayContaining(['broadcast note', 'alpha note']));
  expect(b).toContain('broadcast note');
  expect(b).not.toContain('alpha note');
});

// --- Web comment-form scope chip (TagSidebar). Proves the chip renders for
// a replay shared with 2+ of my teams, and that narrowing via the chip
// sends teamSlugs so the comment is withheld from the deselected team. B71.

test('web comment form: scope chip narrows a comment to one team', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'ChipUser', email: 'chip@example.com' });
  const { slug: teamA } = await createTeam(page, 'Chip Alpha');
  const { slug: teamB } = await createTeam(page, 'Chip Bravo');

  const r = await uploadReplay(request, { local: { username: 'ChipUser' }, opponent: { username: 'Foe' } });
  await claimInstallToken(page, r.installToken);
  for (const teamSlug of [teamA, teamB]) {
    await page.request.post(`/api/replays/${r.slug}/team-shares`, {
      data: { teamSlug }, headers: { 'X-Install-Token': r.installToken },
    });
  }

  await page.goto(`/r/${r.slug}`);
  await page.getByRole('button', { name: /^Tags/ }).click(); // B149: untagged → opens on Game log
  await page.getByRole('button', { name: '+ Tag this frame' }).click();

  // Chip appears (2 teams armed) and defaults to "All 2 teams".
  await expect(page.getByTestId('scope-chip')).toBeVisible();
  await expect(page.getByTestId('scope-chip-label')).toHaveText(/All 2 teams/);

  // Expand, deselect Bravo → narrows to Alpha.
  await page.getByTestId('scope-chip-toggle').click();
  await page.getByRole('checkbox', { name: 'Chip Bravo' }).uncheck();
  await expect(page.getByTestId('scope-chip-label')).toHaveText(/Chip Alpha only/);

  await page.getByPlaceholder(/Your note about this moment/).fill('chip-narrowed to alpha');
  await page.getByText('Save tag').click();

  // Alpha sees it; Bravo does not.
  const comments = async (slug: string) => {
    const res = await page.request.get(`/api/teams/${slug}/discussion`);
    return ((await res.json()).data as any[]).map((i) => i.latestTag?.comment).filter(Boolean);
  };
  await expect.poll(() => comments(teamA)).toContain('chip-narrowed to alpha');
  expect(await comments(teamB)).not.toContain('chip-narrowed to alpha');
});

// B168: regression — a just-saved comment must show its SERVER-resolved
// audience immediately, not "Just me". The optimistic row used to drop the
// returned scope, so a team-shared comment looked personal until a refetch
// (the reported "it switches to visible just to me" on save).
test('web comment form: a saved comment immediately shows its team audience (not Just me)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'SaveScope', email: 'savescope@example.com' });
  const { slug: team } = await createTeam(page, 'Lone Star Destroyers');

  const r = await uploadReplay(request, { local: { username: 'SaveScope' }, opponent: { username: 'Foe' } });
  await claimInstallToken(page, r.installToken);
  await page.request.post(`/api/replays/${r.slug}/team-shares`, {
    data: { teamSlug: team }, headers: { 'X-Install-Token': r.installToken },
  });

  await page.goto(`/r/${r.slug}`);
  await page.getByRole('button', { name: /^Tags/ }).click();
  await page.getByRole('button', { name: '+ Tag this frame' }).click();

  // Leave the scope at its default (the shared team), then save.
  await page.getByPlaceholder(/Your note about this moment/).fill('team-shared by default');
  await page.getByText('Save tag').click();

  // The new comment's readout reflects the team it was actually saved to —
  // NOT "Just me".
  await expect(page.getByText('Visible to: Lone Star Destroyers').first()).toBeVisible();
  await expect(page.getByText('Visible to: Just me')).toHaveCount(0);
});

// --- Editing an existing tag's scope (viewer). PATCH /tags/[id] honours
// teamSlugs, re-resolving + replacing the tag's scope. B71-followup. ---

test('editing a tag can move its team scope (and GET returns current scope)', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Editor', email: 'editor@example.com' });
  const { slug: teamA } = await createTeam(page, 'Edit Alpha');
  const { slug: teamB } = await createTeam(page, 'Edit Bravo');

  const r = await uploadReplay(request, { local: { username: 'Editor' }, opponent: { username: 'Foe' } });
  await claimInstallToken(page, r.installToken);
  for (const teamSlug of [teamA, teamB]) {
    await page.request.post(`/api/replays/${r.slug}/team-shares`, {
      data: { teamSlug }, headers: { 'X-Install-Token': r.installToken },
    });
  }
  // Create scoped to Alpha.
  const created = await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'Editor', frameIndex: 0, comment: 'movable', teamSlugs: [teamA] },
  });
  const { id } = await created.json();

  const comments = async (slug: string) => {
    const res = await page.request.get(`/api/teams/${slug}/discussion`);
    return ((await res.json()).data as any[]).map((i) => i.latestTag?.comment).filter(Boolean);
  };
  const scopeOf = async () => {
    const res = await page.request.get(`/api/replays/${r.slug}/tags`, { headers: { 'X-Install-Token': r.installToken } });
    return ((await res.json()).data as any[]).find((t) => t.id === id)?.scope?.sort();
  };

  // Initially Alpha only.
  expect(await comments(teamA)).toContain('movable');
  expect(await comments(teamB)).not.toContain('movable');
  expect(await scopeOf()).toEqual([teamA]);

  // Edit scope → Bravo.
  const patch = await page.request.patch(`/api/replays/${r.slug}/tags/${id}`, {
    data: { comment: 'movable', teamSlugs: [teamB] },
    headers: { 'X-Install-Token': r.installToken },
  });
  expect(patch.ok()).toBe(true);

  expect(await comments(teamB)).toContain('movable');
  expect(await comments(teamA)).not.toContain('movable');
  expect(await scopeOf()).toEqual([teamB]);
});

test('viewer: a tag shows its scope and can be re-scoped via the edit chip', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'UiEditor', email: 'uieditor@example.com' });
  const { slug: teamA } = await createTeam(page, 'UiEdit Alpha');
  const { slug: teamB } = await createTeam(page, 'UiEdit Bravo');
  const r = await uploadReplay(request, { local: { username: 'UiEditor' }, opponent: { username: 'Foe' } });
  await claimInstallToken(page, r.installToken);
  for (const teamSlug of [teamA, teamB]) {
    await page.request.post(`/api/replays/${r.slug}/team-shares`, {
      data: { teamSlug }, headers: { 'X-Install-Token': r.installToken },
    });
  }
  await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'UiEditor', frameIndex: 0, comment: 'ui rescope me', teamSlugs: [teamA] },
  });

  await page.goto(`/r/${r.slug}`);
  // The tag row shows its current audience.
  await expect(page.getByText('Visible to: UiEdit Alpha only').first()).toBeVisible();

  // Edit it → chip → switch to Bravo → save.
  await page.getByTitle('Edit this tag').first().click();
  await page.getByTestId('scope-chip-toggle').click();
  await page.getByRole('checkbox', { name: 'UiEdit Bravo' }).check();
  await page.getByRole('checkbox', { name: 'UiEdit Alpha' }).uncheck();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const comments = async (slug: string) => {
    const res = await page.request.get(`/api/teams/${slug}/discussion`);
    return ((await res.json()).data as any[]).map((i) => i.latestTag?.comment).filter(Boolean);
  };
  await expect.poll(() => comments(teamB)).toContain('ui rescope me');
  expect(await comments(teamA)).not.toContain('ui rescope me');
});

test('editing a tag can add an @mention that reaches the mentioned member', async ({ page, browser, request }) => {
  await signInAsTestUser(page, { name: 'MentionEditor', email: 'mentionedit@example.com' });
  const { slug: team } = await createTeam(page, 'Mention Edit Team');
  const { code } = await generateInvite(page, team);

  // Teammate joins.
  const ctxB = await browser.newContext();
  const bob = await ctxB.newPage();
  const { userId: bobId } = await signInAsTestUser(bob, { name: 'BobEdit', email: 'bobedit@example.com' });
  await bob.request.post('/api/teams/join', { data: { code } });

  const r = await uploadReplay(request, { local: { username: 'MentionEditor' }, opponent: { username: 'Foe' } });
  await claimInstallToken(page, r.installToken);
  await page.request.post(`/api/replays/${r.slug}/team-shares`, {
    data: { teamSlug: team }, headers: { 'X-Install-Token': r.installToken },
  });
  // Create a plain comment (no mention) scoped to the team by default.
  const created = await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: { installToken: r.installToken, authorName: 'MentionEditor', frameIndex: 0, comment: 'hey look at this' },
  });
  const { id } = await created.json();

  // Edit it to add an @mention of Bob.
  await page.request.patch(`/api/replays/${r.slug}/tags/${id}`, {
    data: { comment: 'hey @BobEdit look at this', mentions: { userIds: [bobId], teamSlugs: [] } },
    headers: { 'X-Install-Token': r.installToken },
  });

  // Bob's inbox now surfaces it.
  const res = await bob.request.get('/api/me/mentions');
  const comments = ((await res.json()).data as any[]).map((t) => t.comment);
  expect(comments).toContain('hey @BobEdit look at this');

  await ctxB.close();
});
