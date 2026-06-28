import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, createTeam, uploadReplay, claimInstallToken } from './helpers';

// B201: the bulk multi-select "Manage" menu now rides the shared ResponsiveMenu
// (same primitive as the viewer Share) instead of its own ActionSheet. This was
// previously untested — assert the core flow still works through the new shell:
// select → open Manage → the menu (role=dialog) renders BulkShareControls →
// staging a team share names it on the Apply button → Apply closes the menu.
test('bulk Manage menu: select all → stage a team share → Apply', async ({ page, request }) => {
  await signInAsTestUser(page, { name: 'BulkOwner', email: `bulk-${randomUUID().slice(0, 6)}@example.com` });
  const { slug: teamSlug } = await createTeam(page, 'Bulk Squad');
  expect(teamSlug).toBeTruthy();

  // Own two replays (claimed token → attributed to the signed-in user, so they're
  // selectable/owned in My replays).
  const token = `kbx_${randomUUID()}`;
  await claimInstallToken(page, token);
  for (let i = 0; i < 2; i++) {
    await uploadReplay(request, { installToken: token, local: { username: 'BulkOwner' }, opponent: { username: `Opp${i}` } });
  }

  await page.goto('/replays');
  // Enter select mode, then select every eligible row.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: /Select all 2/ }).click();

  // Open the bulk Manage menu — now a ResponsiveMenu (anchored popover on desktop).
  await page.getByRole('button', { name: /^Manage/ }).click();
  const menu = page.getByRole('dialog', { name: /Manage 2 replays/ });
  await expect(menu).toBeVisible();

  // Stage a team share; the staged-apply footer names the single change.
  await menu.getByRole('checkbox', { name: 'Bulk Squad' }).check();
  const apply = menu.getByRole('button', { name: /Share 2 replays with Bulk Squad/ });
  await expect(apply).toBeEnabled();
  await apply.click();

  // Applying dismisses the menu (close() from the children render-prop).
  await expect(menu).toBeHidden();
});
