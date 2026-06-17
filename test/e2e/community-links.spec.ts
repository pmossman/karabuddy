import { test, expect } from '@playwright/test';

// Community/external links all live in the footer as a consistent icon+label
// set (GitHub, Discord "Join", Ko-fi "Support") — kept out of the header so the
// support ask never reads as prominent.

const DISCORD = 'https://discord.gg/DnbpNa6yzv';
const KOFI = 'https://ko-fi.com/karabuddy';
const GITHUB = 'https://github.com/pmossman/karabuddy';

test('footer carries GitHub / Discord(Join) / Support, opening in new tabs', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/replays'); // public page — no sign-in needed

  const footer = page.getByRole('contentinfo');

  const github = footer.getByRole('link', { name: 'karabuddy on GitHub' });
  await expect(github).toHaveAttribute('href', GITHUB);
  await expect(github).toContainText('GitHub');

  const discord = footer.getByRole('link', { name: 'Join our Discord' });
  await expect(discord).toHaveAttribute('href', DISCORD);
  await expect(discord).toHaveAttribute('target', '_blank');
  await expect(discord).toContainText('Join');

  const support = footer.getByRole('link', { name: 'Support karabuddy on Ko-fi' });
  await expect(support).toHaveAttribute('href', KOFI);
  await expect(support).toHaveAttribute('target', '_blank');
  await expect(support).toContainText('Support');
});

test('the header carries no Discord/support link (community links are footer-only)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/replays');

  await expect(page.getByRole('banner').getByRole('link', { name: /discord|support/i })).toHaveCount(0);
});
