import { test, expect } from '@playwright/test';
import { signInAsTestUser, uploadReplay, claimInstallToken, createTeam } from './helpers';

// Two bugs surfaced in the viewer's tag flow:
//
// 1. Tags written by a signed-in user were attributed to the extension's
//    anon-XXX localStorage handle, not the session's display name — so
//    the tag row showed up as `anon-7mqy` instead of "Parker".
// 2. Team @-mentions exposed the raw team slug to the user, both in the
//    autocomplete popover and the inserted mention text (`@team:k2x8tw`).
//
// B216: composing happens in the floating Tag HUD (rail "Tags" button); the
// tag feed lives in the sidebar panel's Tags view (rail "Sidebar" button /
// ?panel=tags deep link).

test('signed-in user: new tag attributes to session display name', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'NamedAuthor', email: 'na@example.com' });
  const r = await uploadReplay(request, {
    local: { username: 'NamedAuthor' },
    opponent: { username: 'X' },
  });
  await claimInstallToken(page, r.installToken);

  await page.goto(`/r/${r.slug}`);
  await expect(page.getByTestId('board')).toHaveAttribute('data-frames', '1');
  await page.getByRole('button', { name: 'Tags', exact: true }).click(); // open the Tag HUD
  await page.getByRole('button', { name: 'Add tag' }).click();
  await page.getByPlaceholder(/Your note about this moment/).fill('important moment');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // The tag feed (panel Tags view — the docked <aside>) bylines the session
  // display name, not the anon handle. Scoped to the aside because the board
  // also renders "NamedAuthor" as a player name.
  await page.getByRole('button', { name: 'Sidebar' }).click();
  const feed = page.locator('aside');
  await expect(feed.getByText('important moment')).toBeVisible();
  await expect(feed.getByText('NamedAuthor').first()).toBeVisible();
  await expect(feed.getByText(/anon-/)).toHaveCount(0);
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
  await expect(page.getByTestId('board')).toHaveAttribute('data-frames', '1');
  await page.getByRole('button', { name: 'Tags', exact: true }).click(); // open the Tag HUD
  // The autocomplete data is lazily fetched when the composer first opens.
  // Typing before it resolves races the fetch (the source of this test's
  // historical flakiness), so wait for the response before typing @.
  const mentionData = page.waitForResponse((res) => res.url().includes('/api/me/teams-mention-data'));
  await page.getByRole('button', { name: 'Add tag' }).click();
  await mentionData;
  await page.getByPlaceholder(/Your note about this moment/).fill('@Auto');

  const popover = page.locator('[data-mention-popover]');
  await expect(popover).toBeVisible({ timeout: 3000 });
  await expect(popover).toContainText('AutoTeam');
  await expect(popover).not.toContainText(teamSlug);
});

// The inserted mention format is `@team:<TeamNameStripped>` — the slug never
// enters user-visible text (the structured mentions struct carries it for
// notifications). B216 gap: the redesign HUD/feed render comment text RAW
// (MentionedComment's team-mention-pill is no longer used in the viewer), so
// this asserts on the raw text: team NAME present, slug absent.
test('team-mention in a comment surfaces team name, not slug', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'Mentioner', email: 'mn@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'PillTeam');
  const r = await uploadReplay(request, {
    local: { username: 'Mentioner' },
    opponent: { username: 'X' },
  });
  await claimInstallToken(page, r.installToken);

  // Simulate the insertion format the autocomplete produces —
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

  // ?panel=tags deep-links the sidebar panel open on the tag feed.
  await page.goto(`/r/${r.slug}?panel=tags`);
  await expect(page.getByTestId('board')).toHaveAttribute('data-frames', '1');
  const feed = page.locator('aside');
  await expect(feed.getByText(/heads up/)).toBeVisible();
  await expect(feed.getByText(/PillTeam/).first()).toBeVisible();
  await expect(feed.getByText(new RegExp(teamSlug))).toHaveCount(0);
});
