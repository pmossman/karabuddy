import type { APIRequestContext, Page } from '@playwright/test';

// Test sign-in helper. Calls the test-only /api/test/sign-in endpoint
// to mint a real Auth.js session in the DB, then sets the cookie on
// the Playwright browser context.
//
// Real session via the real auth() flow — only OAuth itself is bypassed.
export async function signInAsTestUser(
  page: Page,
  request: APIRequestContext,
  opts: { email?: string; name?: string } = {}
): Promise<{ userId: string }> {
  const res = await request.post('/api/test/sign-in', {
    data: { email: opts.email, name: opts.name ?? 'Test User' },
  });
  if (!res.ok()) {
    throw new Error(`test sign-in failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  await page.context().addCookies([
    {
      name: body.cookieName,
      value: body.cookieValue,
      url: page.url() || (await request.head('/')).url(),
      sameSite: 'Lax',
      httpOnly: true,
    },
  ]);
  return { userId: body.userId };
}
