import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { syntheticReplayPayload } from '../e2e/fixtures/replay-payload';

// Smoke suite for a LIVE deploy (real build + isolated preview DB). The gate
// before a commit is promoted to production. Read-only checks + ONE write
// round-trip (synthetic upload → the replay is fetchable), so a broken build,
// missing migration, or DB misconfig fails here instead of in prod.

test('home page renders', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page.getByText(/KARA|replays|sign in/i).first()).toBeVisible();
});

test('whoami responds 401 unauthenticated (app + auth wired)', async ({ request }) => {
  const res = await request.get('/api/me/whoami', { headers: { 'X-Install-Token': 'kbx_smoke' } });
  expect(res.status()).toBe(401);
});

test('extension status endpoint returns JSON', async ({ request }) => {
  const res = await request.get('/api/extension/status?v=0.5.0');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.status).toBeTruthy();
  expect(body.latestVersion).toBeTruthy();
});

test('upload → replay round-trips against the live DB', async ({ request }) => {
  // Real upload (no test endpoints needed) writes to the preview DB; then
  // the replay page must render — proving build + migrations + DB read/write.
  const installToken = `kbx_smoke_${randomUUID()}`;
  const { payload } = syntheticReplayPayload({ local: { username: 'SmokeLocal' }, opponent: { username: 'SmokeOpp' } });
  const up = await request.post('/api/replays', { data: { installToken, payload } });
  expect(up.ok(), `upload failed: ${up.status()} ${await up.text()}`).toBe(true);
  const { slug } = await up.json();
  expect(slug).toBeTruthy();

  const viewer = await request.get(`/r/${slug}`);
  expect(viewer.status()).toBe(200);
});
