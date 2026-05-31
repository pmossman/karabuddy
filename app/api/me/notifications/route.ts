import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { users } from '@/lib/schema';

export const runtime = 'nodejs';

// B81: the user's global Discord-notifications kill switch. When
// notificationsDisabled is true, notifyMentions skips them entirely (overrides
// every per-team pref). Session-only (a /settings control).
//
//   GET   → { ok, notificationsDisabled }
//   PATCH { notificationsDisabled: boolean }

async function userId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as any)?.id || null;
}

export async function GET() {
  const id = await userId();
  if (!id) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  const [row] = await getDb().select({ off: users.notificationsDisabled }).from(users).where(eq(users.id, id)).limit(1);
  return NextResponse.json({ ok: true, notificationsDisabled: !!row?.off });
}

export async function PATCH(req: Request) {
  const id = await userId();
  if (!id) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.notificationsDisabled !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'notificationsDisabled must be a boolean' }, { status: 400 });
  }
  await getDb().update(users).set({ notificationsDisabled: body.notificationsDisabled }).where(eq(users.id, id));
  return NextResponse.json({ ok: true, notificationsDisabled: body.notificationsDisabled });
}
