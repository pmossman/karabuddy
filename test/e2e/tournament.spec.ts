import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, generateInvite, uploadReplay, claimInstallToken } from './helpers';

// B124: team tournaments. P2 covers the setup phase end-to-end in a real
// browser: create from the team tab → self-register → organizer adds a guest.
// (Decklist import is API-tested with a stubbed upstream; e2e registers
// without a deck so no external fetch is needed.)

test('create a tournament, self-register, and add a guest entrant', async ({ page }) => {
  await signInAsTestUser(page, { name: 'TO' });
  const { slug } = await createTeam(page, 'Tourney Team');

  // Tournaments tab → create.
  await page.goto(`/teams/${slug}?tab=tournaments`);
  await page.getByRole('button', { name: '+ New tournament' }).click();
  await page.getByPlaceholder(/June Worlds Prep/).fill('Friday Swiss');
  await page.getByRole('button', { name: 'Create tournament' }).click();
  await expect(page.getByText('Friday Swiss')).toBeVisible();
  await expect(page.getByText('Registration')).toBeVisible();

  // Into the detail page.
  await page.getByText('Friday Swiss').click();
  await expect(page).toHaveURL(/\/tournaments\/tn_/);
  await expect(page.getByText('Registration open')).toBeVisible();
  await expect(page.getByText('Nobody has registered yet.')).toBeVisible();

  // Self-register (no deck).
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByTestId('entrant-row')).toHaveCount(1);
  await expect(page.getByText('You', { exact: true })).toBeVisible();

  // Organizer adds a guest (player without a karabuddy account) via the modal.
  await page.getByRole('button', { name: '+ Add guest player' }).click();
  await expect(page.getByTestId('guest-modal')).toBeVisible();
  await page.getByPlaceholder('e.g. Mando Mike').fill('Manual Mike');
  await page.getByTestId('guest-modal').getByRole('button', { name: 'Add guest' }).click();
  await expect(page.getByTestId('guest-modal')).toHaveCount(0); // closes on save
  await expect(page.getByTestId('entrant-row')).toHaveCount(2);
  await expect(page.getByText('Manual Mike')).toBeVisible();
  await expect(page.getByText('Guest', { exact: true })).toBeVisible();

  // The organizer can reopen the modal to edit the guest (rename).
  await page.getByTestId('entrant-row').filter({ hasText: 'Manual Mike' }).getByRole('button', { name: 'Edit' }).click();
  await page.getByPlaceholder('e.g. Mando Mike').fill('Manual Michael');
  await page.getByTestId('guest-modal').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Manual Michael')).toBeVisible();
});

test('full lifecycle: start (bye) → report → standings → round 2 → finish', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Organizer' });
  const { slug } = await createTeam(page, 'Lifecycle Team');
  await page.goto(`/teams/${slug}?tab=tournaments`);
  await page.getByRole('button', { name: '+ New tournament' }).click();
  await page.getByPlaceholder(/June Worlds Prep/).fill('Season Swiss');
  await page.getByRole('button', { name: 'Create tournament' }).click();
  await page.getByText('Season Swiss').click();

  // 3 entrants: the organizer + two guests → odd field, one bye.
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  for (const g of ['Guest Alpha', 'Guest Beta']) {
    await page.getByRole('button', { name: '+ Add guest player' }).click();
    await page.getByPlaceholder('e.g. Mando Mike').fill(g);
    await page.getByTestId('guest-modal').getByRole('button', { name: 'Add guest' }).click();
    await expect(page.getByText(g)).toBeVisible();
  }

  await page.getByRole('button', { name: /Start tournament/ }).click();
  await expect(page.getByText('In progress', { exact: true })).toBeVisible();
  await expect(page.getByTestId('round-1')).toBeVisible();
  await expect(page.getByText('— bye')).toBeVisible(); // odd field
  await expect(page.getByTestId('standings-table')).toBeVisible();

  // Report the one real match 2-1 (organizer report lands as Final).
  await page.getByRole('button', { name: '2–1', exact: true }).click();
  await expect(page.getByText('Final')).toBeVisible();
  await expect(page.getByTestId('match-score').filter({ hasText: '2–1' })).toBeVisible();

  // Pair round 2, then finish.
  await page.getByRole('button', { name: 'Pair round 2' }).click();
  await expect(page.getByTestId('round-2')).toBeVisible();
  // Round 2: report its real match so finish is allowed.
  await page.getByTestId('round-2').getByRole('button', { name: '2–0', exact: true }).first().click();
  await page.getByRole('button', { name: 'Finish tournament' }).click();
  await expect(page.getByText('Finished')).toBeVisible();

  // Standings: somebody is on top with points; winner has 6 (two 2-0/2-1 wins
  // incl. possible bye credit).
  const firstRow = page.getByTestId('standings-table').locator('tbody tr').first();
  await expect(firstRow).toContainText(/[36]/);
});

test('a recorded replay drives a result suggestion the organizer confirms', async ({ page, browser, request }) => {
  // Organizer A creates team + tournament and registers.
  await signInAsTestUser(page, { name: 'SuggestTO', email: 'suggest-to@example.com' });
  const { slug } = await createTeam(page, 'Suggestion Squad');
  const { code } = await generateInvite(page, slug);
  const createRes = await page.request.post(`/api/teams/${slug}/tournaments`, {
    data: { name: 'Replay Cup', decklistVisibility: 'open' },
  });
  const { id } = await createRes.json();
  await page.request.post(`/api/teams/${slug}/tournaments/${id}/entrants`, { data: {} });

  // Member B joins the team + registers (separate browser context).
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signInAsTestUser(page2, { name: 'SuggestP2', email: 'suggest-p2@example.com' });
  await page2.goto(`/teams/join?code=${code}`);
  await page2.waitForURL(new RegExp(`/teams/${slug}`));
  await page2.request.post(`/api/teams/${slug}/tournaments/${id}/entrants`, { data: {} });
  await ctx2.close();

  // Start → round 1 pairs A vs B.
  await page.request.post(`/api/teams/${slug}/tournaments/${id}/start`);

  // A records a decisive game AFTER the round started and claims the install
  // token (claim backfills replays.userId → the replay is attributed to A).
  const up = await uploadReplay(request, {
    local: { id: 'pw1', username: 'SuggestTO' },
    opponent: { id: 'pw2', username: 'SuggestP2' },
    match: { lobbyId: `lobby-sugg-${Date.now()}` },
    winners: ['pw1'],
  });
  await claimInstallToken(page, up.installToken);

  // The detail page shows the suggestion banner on A's pending match.
  await page.goto(`/teams/${slug}/tournaments/${id}`);
  await expect(page.getByTestId('suggestion-banner')).toBeVisible();
  await expect(page.getByTestId('suggestion-banner')).toContainText(/Detected/);

  // Organizer confirms → result locks with the suggested score.
  await page.getByRole('button', { name: /^Confirm/ }).click();
  await expect(page.getByText('Final')).toBeVisible();
  await expect(page.getByTestId('suggestion-banner')).toHaveCount(0);
});

test('invite link: signed-out guest self-registers, then claims with a new account', async ({ page, browser }) => {
  // Organizer creates the tournament + mints the invite link.
  await signInAsTestUser(page, { name: 'InviteTO', email: 'invite-to@example.com' });
  const { slug } = await createTeam(page, 'Invite League');
  const createRes = await page.request.post(`/api/teams/${slug}/tournaments`, { data: { name: 'Open Night' } });
  const { id } = await createRes.json();
  const mint = await (await page.request.post(`/api/teams/${slug}/tournaments/${id}/invite`)).json();
  expect(mint.ok).toBe(true);

  // A SIGNED-OUT guest opens the link and registers with just a name.
  const guestCtx = await browser.newContext();
  const guestPage = await guestCtx.newPage();
  await guestPage.goto(`/tournaments/join?code=${mint.code}`);
  await expect(guestPage.getByText('Open Night')).toBeVisible();
  await guestPage.getByPlaceholder(/How should pairings show you/).fill('Walk-in Wanda');
  await guestPage.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(guestPage.getByText(/You're registered!/)).toBeVisible();
  await expect(guestPage.getByText('Walk-in Wanda')).toBeVisible(); // entrant chip

  // The guest creates an account (same browser → stored claim token) and
  // claims: the entry links to the account and the TOURNAMENT page opens for
  // them — but they do NOT join the team (B127: decoupled).
  await signInAsTestUser(guestPage, { name: 'Wanda Real', email: 'wanda@example.com' });
  await guestPage.goto(`/tournaments/join?code=${mint.code}`);
  await guestPage.getByRole('button', { name: /Claim my registration/ }).click();
  await guestPage.waitForURL(new RegExp(`/teams/${slug}/tournaments/${id}`));
  await expect(guestPage.getByText('Wanda Real')).toBeVisible(); // renamed to account
  await expect(guestPage.getByTestId('entrant-row')).toHaveCount(1); // entrant-scoped view works
  // No team back-link for an entrant-only viewer.
  await expect(guestPage.getByText('← Tournaments')).toHaveCount(0);
  await guestCtx.close();

  // Organizer's view: one entrant, linked (no Guest badge) — but NOT a teammate.
  await page.goto(`/teams/${slug}/tournaments/${id}`);
  await expect(page.getByTestId('entrant-row')).toHaveCount(1);
  await expect(page.getByText('Guest', { exact: true })).toHaveCount(0);
  await page.goto(`/teams/${slug}?tab=members`);
  await expect(page.getByText('Wanda Real')).toHaveCount(0); // decoupled: no team join
});

test('unregister removes the entrant while in setup', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Leaver' });
  const { slug } = await createTeam(page, 'Leavers');
  await page.goto(`/teams/${slug}?tab=tournaments`);
  await page.getByRole('button', { name: '+ New tournament' }).click();
  await page.getByPlaceholder(/June Worlds Prep/).fill('Quick Cup');
  await page.getByRole('button', { name: 'Create tournament' }).click();
  await page.getByText('Quick Cup').click();

  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByTestId('entrant-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Unregister' }).click();
  await expect(page.getByTestId('entrant-row')).toHaveCount(0);
});
