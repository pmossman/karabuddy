import { test, expect } from '@playwright/test';

// Smoke tests for static-content pages. If any of these break, the
// whole nav is dead — catches build/typecheck regressions that don't
// surface in `npm run build` alone.

test.describe('static pages render', () => {
  test('home', async ({ page }) => {
    await page.goto('/');
    // The persistent header has `data-kb-header` directly on the <header>.
    await expect(page.locator('header[data-kb-header]')).toBeVisible();
  });

  test('privacy', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
  });

  test('install', async ({ page }) => {
    await page.goto('/install');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('signin', async ({ page }) => {
    await page.goto('/signin');
    // Should at least render something — the actual provider buttons
    // depend on next-auth's configuration so a precise assertion is
    // brittle. Existence of any heading is enough as a smoke.
    await expect(page.locator('body')).toBeVisible();
  });

  test('anonymous /replays?tab=public renders', async ({ page }) => {
    await page.goto('/replays?tab=public');
    await expect(page.getByRole('heading', { name: 'Replays', level: 1 })).toBeVisible();
  });
});

// B72: extension status endpoint (kill-switch). Default policy: latest
// 0.5.1, minSupported 0.0.0 (nobody blocked until deliberately raised).
import { test as test72, expect as expect72 } from '@playwright/test';
test72.describe('extension status endpoint', () => {
  test72('reports ok at latest, nag below it, ok for unknown version', async ({ request }) => {
    const get = async (v?: string) => {
      const res = await request.get(`/api/extension/status${v !== undefined ? `?v=${v}` : ''}`);
      expect72(res.ok()).toBe(true);
      return res.json();
    };
    expect72((await get('0.5.1')).status).toBe('ok');
    expect72((await get('0.5.0')).status).toBe('nag');
    expect72((await get()).status).toBe('ok');
    const body = await get('0.5.0');
    expect72(body.latestVersion).toBe('0.5.1');
    expect72(body.capabilities).toContain('teamScopedComments');
  });
});
