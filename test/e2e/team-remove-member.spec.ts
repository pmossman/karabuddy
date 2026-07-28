import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, generateInvite } from './helpers';

// An owner removes a member from team Settings, via a select + an explicit
// "are you sure?" confirmation. Mirrors the transfer-ownership Settings flow.
test('owner removes a member from Settings with confirmation', async ({ page, browser }) => {
  await signInAsTestUser(page, { name: 'OwnerR', email: 'owner-remove@example.com' });
  const { slug } = await createTeam(page, 'Remove Team');
  const { code } = await generateInvite(page, slug);

  // A second member joins via the invite.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await signInAsTestUser(pageB, { name: 'MemberR', email: 'member-remove@example.com' });
  expect((await pageB.request.post('/api/teams/join', { data: { code } })).ok()).toBeTruthy();

  // Owner Settings: the remove control shows once there's another member.
  await page.goto(`/teams/${slug}?tab=settings`);
  await expect(page.getByTestId('remove-member-target')).toBeVisible();
  await page.getByTestId('remove-member-target').selectOption({ label: 'MemberR' });
  await page.getByTestId('remove-member-open').click();

  // Confirmation ("are you sure?") step, then commit.
  await expect(page.getByText(/Remove MemberR from the team\?/)).toBeVisible();
  await page.getByTestId('remove-member-confirm').click();

  // Only the owner is left → no removable members → the control disappears.
  await expect(page.getByTestId('remove-member-target')).toHaveCount(0);

  // The roster no longer lists the removed member (OwnerR also appears in the
  // sidebar account footer, so scope the positive check with .first()).
  await page.goto(`/teams/${slug}?tab=members`);
  await expect(page.getByText('OwnerR', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('MemberR', { exact: true })).toHaveCount(0);

  await ctxB.close();
});

test('a non-owner member never sees the remove control', async ({ page, browser }) => {
  await signInAsTestUser(page, { name: 'OwnerS', email: 'owner-remove2@example.com' });
  const { slug } = await createTeam(page, 'Remove Team 2');
  const { code } = await generateInvite(page, slug);

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await signInAsTestUser(pageB, { name: 'MemberS', email: 'member-remove2@example.com' });
  expect((await pageB.request.post('/api/teams/join', { data: { code } })).ok()).toBeTruthy();

  // The member's own Settings has no owner-only remove control.
  await pageB.goto(`/teams/${slug}?tab=settings`);
  await expect(pageB.getByTestId('remove-member-target')).toHaveCount(0);

  await ctxB.close();
});
