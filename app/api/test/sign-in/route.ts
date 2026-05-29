import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users, sessions } from '@/lib/schema';

export const runtime = 'nodejs';

// Test-only sign-in. Disabled outside of NODE_ENV=test (or when the
// KARABUDDY_TEST_API=1 escape hatch isn't set). Creates a real users row
// and a real Auth.js sessions row, then returns the session cookie so
// the caller can attach it to subsequent requests.
//
// Why a real DB session: route handlers call `auth()` which reads the
// session cookie + looks up the sessions table — mocking only at the
// JS layer (vi.mock) doesn't cover that path. Using real Auth.js
// sessions means the test exercises the same code path as prod.
//
// Body: { email?: string, name?: string }
// Response: { ok: true, userId, cookieName, cookieValue }
//   The client sets the cookie on its requests. Auth.js's default
//   session-token cookie name varies between dev/prod (auth.js-secret +
//   `-Secure` prefix in prod) — we read it back from process.env or
//   default to the dev name.
export async function POST(req: Request) {
  if (!isTestModeEnabled()) {
    return NextResponse.json({ ok: false, error: 'test mode not enabled' }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const email: string = String(body.email || `test-${randomUUID().slice(0, 8)}@example.com`);
  const name: string = String(body.name || 'Test User');

  const db = getDb();

  // Reuse existing user with this email if present (lets a test re-use
  // a fixture email across requests).
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const userId = existing?.id ?? randomUUID();
  if (!existing) {
    await db.insert(users).values({ id: userId, name, email });
  }

  const sessionToken = randomUUID() + '-' + randomUUID();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ sessionToken, userId, expires });

  return NextResponse.json({
    ok: true,
    userId,
    cookieName: sessionCookieName(),
    cookieValue: sessionToken,
  });
}

function isTestModeEnabled(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.KARABUDDY_TEST_API === '1';
}

function sessionCookieName(): string {
  // Auth.js v5 default cookie name. `__Secure-` prefix only in https.
  return process.env.AUTH_URL?.startsWith('https://')
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}
