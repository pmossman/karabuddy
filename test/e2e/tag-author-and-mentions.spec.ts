import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken, createTeam } from './helpers';

// Two bugs surfaced in the viewer's tag flow:
//
// 1. Tags written by a signed-in user were attributed to the extension's
//    anon-XXX localStorage handle, not the session's display name — so
//    the tag row showed up as `anon-7mqy` instead of "Parker".
// 2. Team @-mentions exposed the raw team slug to the user, both in the
//    autocomplete popover and the rendered pill (`@team:k2x8tw`).

test('signed-in user: new tag attributes to session display name', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'NamedAuthor', email: 'na@example.com' });
  const r = await uploadReplay(request, {
    local: { username: 'NamedAuthor' },
    opponent: { username: 'X' },
  });
  await claimInstallToken(page, r.installToken);

  await page.goto(`/r/${r.slug}`);
  await page.getByRole('button', { name: /Tag this frame/i }).click();
  await page.locator('textarea').first().fill('important moment');
  await page.getByRole('button', { name: 'Save tag' }).click();

  // The new tag's author byline shows "NamedAuthor", not the anon handle.
  const sidebar = page.locator('aside');
  await expect(sidebar.getByText('important moment')).toBeVisible();
  await expect(sidebar.getByText('NamedAuthor').first()).toBeVisible();
  await expect(sidebar.getByText(/anon-/)).toHaveCount(0);
});

test('team-mention autocomplete suggestion shows team name, not slug', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'AutoCompleter', email: 'ac@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'AutoTeam');
  const r = await uploadReplay(request, {
    local: { username: 'AutoCompleter' },
    opponent: { username: 'X' },
  });
  await claimInstallToken(page, r.installToken);

  await page.goto(`/r/${r.slug}`);
  // The autocomplete data is lazily fetched when the tag form first opens.
  // Typing before it resolves races the fetch (the source of this test's
  // historical flakiness), so wait for the response before typing @.
  const mentionData = page.waitForResponse((res) => res.url().includes('/api/me/teams-mention-data'));
  await page.getByRole('button', { name: /Tag this frame/i }).click();
  await mentionData;
  await page.locator('textarea').first().fill('@Auto');

  const popover = page.locator('[data-mention-popover]');
  await expect(popover).toBeVisible({ timeout: 3000 });
  await expect(popover).toContainText('AutoTeam');
  await expect(popover).not.toContainText(teamSlug);
});

test('team-mention pill renders team name, not slug', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Mentioner', email: 'mn@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'PillTeam');
  const r = await uploadReplay(request, {
    local: { username: 'Mentioner' },
    opponent: { username: 'X' },
  });
  await claimInstallToken(page, r.installToken);

  // Simulate the NEW insertion format the autocomplete will produce —
  // `@team:<TeamNameStripped>` instead of `@team:<slug>`. The structured
  // mentions struct still carries the slug for notifications.
  await page.request.post(`/api/replays/${r.slug}/tags`, {
    data: {
      installToken: r.installToken,
      authorName: 'Mentioner',
      frameIndex: 0,
      comment: 'heads up @team:PillTeam',
      mentions: { userIds: [], teamSlugs: [teamSlug] },
    },
  });

  await page.goto(`/r/${r.slug}`);
  const pill = page.locator('aside [data-testid="team-mention-pill"]').first();
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('PillTeam');
  await expect(pill).not.toContainText(teamSlug);
});
