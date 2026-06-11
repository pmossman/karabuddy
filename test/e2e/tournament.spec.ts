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
