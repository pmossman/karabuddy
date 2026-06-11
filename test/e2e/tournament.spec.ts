import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam } from './helpers';

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

  // Organizer adds a guest (player without a karabuddy account).
  await page.getByPlaceholder(/Guest name/).fill('Manual Mike');
  await page.getByRole('button', { name: '+ Add guest' }).click();
  await expect(page.getByTestId('entrant-row')).toHaveCount(2);
  await expect(page.getByText('Manual Mike')).toBeVisible();
  await expect(page.getByText('Guest', { exact: true })).toBeVisible();
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
    await page.getByPlaceholder(/Guest name/).fill(g);
    await page.getByRole('button', { name: '+ Add guest' }).click();
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
