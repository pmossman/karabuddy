import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam } from './helpers';

// B192: a team owner can permanently delete a team from Settings → Danger zone,
// gated by typing the exact team name. After delete the team is gone and the owner
// is sent back to /teams.
test('owner deletes a team — typed-name gated, then it is gone', async ({ page }) => {
  await signInAsTestUser(page, { name: 'Team Deleter' });
  const { slug } = await createTeam(page, 'Deletable Squad');
  await page.goto(`/teams/${slug}?tab=settings`);

  // Owner sees the danger zone; opening it reveals the confirm step.
  const open = page.getByTestId('delete-open');
  await expect(open).toBeVisible({ timeout: 15000 });
  await open.click();

  // Delete is disabled until the typed name matches EXACTLY.
  const input = page.getByTestId('delete-confirm-input');
  const confirm = page.getByTestId('delete-confirm');
  await expect(confirm).toBeDisabled();
  await input.fill('Deletable squad'); // wrong case
  await expect(confirm).toBeDisabled();
  await input.fill('Deletable Squad');
  await expect(confirm).toBeEnabled();

  // Delete → redirected to /teams, and the team no longer exists.
  await confirm.click();
  await page.waitForURL('**/teams');
  // The team is gone — it's no longer accessible (deleted → non-member gate).
  expect((await page.request.get(`/api/teams/${slug}`)).ok()).toBe(false);
});
