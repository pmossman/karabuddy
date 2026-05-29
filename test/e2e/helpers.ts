import type { APIRequestContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { syntheticReplayPayload, type SyntheticReplayOpts } from './fixtures/replay-payload';

// Test sign-in helper. Calls the test-only /api/test/sign-in endpoint
// to mint a real Auth.js session in the DB, then sets the cookie on
// the page's browser context.
//
// IMPORTANT: subsequent authenticated API calls in the same test must
// use `page.request.post(...)` (which shares cookies with the page),
// NOT the standalone `request` fixture (which has its own cookie jar
// and would still be anonymous).
//
// Real session via the real auth() flow — only OAuth itself is bypassed.
export async function signInAsTestUser(
  page: Page,
  opts: { email?: string; name?: string } = {}
): Promise<{ userId: string }> {
  const res = await page.request.post('/api/test/sign-in', {
    data: { email: opts.email, name: opts.name ?? 'Test User' },
  });
  if (!res.ok()) {
    throw new Error(`test sign-in failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001';
  await page.context().addCookies([
    {
      name: body.cookieName,
      value: body.cookieValue,
      url: baseUrl,
      sameSite: 'Lax',
      httpOnly: true,
    },
  ]);
  return { userId: body.userId };
}

// Upload a synthetic replay. Auth-free — uploads use install token, not session.
export async function uploadReplay(
  request: APIRequestContext,
  opts: SyntheticReplayOpts & { installToken?: string }
): Promise<{ slug: string; installToken: string; gameId: string; localPlayerId: string }> {
  const installToken = opts.installToken ?? `kbx_${randomUUID()}`;
  const { payload, gameId, localPlayerId } = syntheticReplayPayload(opts);
  const res = await request.post('/api/replays', {
    data: { installToken, payload },
  });
  if (!res.ok()) {
    throw new Error(`upload replay failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  return { slug: body.slug, installToken, gameId, localPlayerId };
}

// Create a team as the user signed in on `page` (uses page.request so
// the session cookie attaches automatically).
export async function createTeam(page: Page, name: string): Promise<{ slug: string }> {
  const res = await page.request.post('/api/teams', { data: { name } });
  if (!res.ok()) throw new Error(`createTeam failed: ${res.status()} ${await res.text()}`);
  const body = await res.json();
  return { slug: body.slug };
}

// Generate a team invite (owner-only) as the user signed in on `page`.
export async function generateInvite(page: Page, teamSlug: string): Promise<{ code: string }> {
  const res = await page.request.post(`/api/teams/${teamSlug}/invites`, { data: {} });
  if (!res.ok()) throw new Error(`generateInvite failed: ${res.status()} ${await res.text()}`);
  const body = await res.json();
  return { code: body.code };
}

// Claim an extension install token as the user signed in on `page`.
export async function claimInstallToken(page: Page, token: string): Promise<void> {
  const res = await page.request.post('/api/me/claim', { data: { token } });
  if (!res.ok()) throw new Error(`claim failed: ${res.status()} ${await res.text()}`);
}
