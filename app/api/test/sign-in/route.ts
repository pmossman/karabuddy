import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users, sessions } from '@/lib/schema';

export const runtime = 'nodejs';

// Test-only sign-in. Disabled outside of NODE_ENV=test (or the
// KARABUDDY_TEST_API=1 escape hatch). Creates a real users row + a real Auth.js
// sessions row so route handlers' `auth()` (which reads the cookie + looks up
// the sessions table) sees the same path as prod.
//
//   POST  body { email?, name? } → { ok, userId, cookieName, cookieValue }
//         (the e2e harness reads the cookie value and attaches it itself.)
//   GET   ?email=you@example.com[&name=..][&redirect=/path] → SETS the session
//         cookie on the browser and redirects. Lets a human stay signed in on the
//         dev port across reloads (OAuth can't complete on localhost:3006), so
//         personal-scoped tags/comments stay visible. Same gate.

async function ensureSession(email: string, name: string): Promise<{ userId: string; sessionToken: string; expires: Date }> {
  const db = getDb();
  // Reuse an existing user with this email (so a fixture/account is stable).
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const userId = existing?.id ?? randomUUID();
  if (!existing) await db.insert(users).values({ id: userId, name, email });
  const sessionToken = randomUUID() + '-' + randomUUID();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ sessionToken, userId, expires });
  return { userId, sessionToken, expires };
}

function isTestModeEnabled(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.KARABUDDY_TEST_API === '1';
}

function sessionCookieName(): string {
  // Auth.js v5 default cookie name. `__Secure-` prefix only over https.
  return process.env.AUTH_URL?.startsWith('https://')
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

export async function POST(req: Request) {
  if (!isTestModeEnabled()) {
    return NextResponse.json({ ok: false, error: 'test mode not enabled' }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const email: string = String(body.email || `test-${randomUUID().slice(0, 8)}@example.com`);
  const name: string = String(body.name || 'Test User');
  const { userId, sessionToken } = await ensureSession(email, name);
  return NextResponse.json({ ok: true, userId, cookieName: sessionCookieName(), cookieValue: sessionToken });
}

export async function GET(req: Request) {
  if (!isTestModeEnabled()) {
    return NextResponse.json({ ok: false, error: 'test mode not enabled' }, { status: 404 });
  }
  const url = new URL(req.url);
  const email = url.searchParams.get('email');
  if (!email) return NextResponse.json({ ok: false, error: 'email query param required' }, { status: 400 });
  const name = url.searchParams.get('name') || 'Test User';
  const redirectTo = url.searchParams.get('redirect') || '/';
  const { sessionToken, expires } = await ensureSession(email, name);
  const res = NextResponse.redirect(new URL(redirectTo, url.origin));
  // Match Auth.js's dev session cookie: httpOnly, lax, root path, not secure on
  // http localhost — so the browser persists + sends it across reloads.
  res.cookies.set(sessionCookieName(), sessionToken, { httpOnly: true, sameSite: 'lax', path: '/', expires });
  return res;
}
