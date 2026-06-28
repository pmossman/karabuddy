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
  return session?.user?.id || null;
}

export async function GET() {
  const id = await userId();
  if (!id) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  const [row] = await getDb().select({ off: users.notificationsDisabled, reviewDm: users.reviewDmEnabled }).from(users).where(eq(users.id, id)).limit(1);
  return NextResponse.json({ ok: true, notificationsDisabled: !!row?.off, reviewDmEnabled: row?.reviewDm ?? true });
}

export async function PATCH(req: Request) {
  const id = await userId();
  if (!id) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  // Either flag may be present; both are independent booleans.
  const set: Record<string, boolean> = {};
  if (body.notificationsDisabled !== undefined) {
    if (typeof body.notificationsDisabled !== 'boolean') return NextResponse.json({ ok: false, error: 'notificationsDisabled must be a boolean' }, { status: 400 });
    set.notificationsDisabled = body.notificationsDisabled;
  }
  if (body.reviewDmEnabled !== undefined) {
    if (typeof body.reviewDmEnabled !== 'boolean') return NextResponse.json({ ok: false, error: 'reviewDmEnabled must be a boolean' }, { status: 400 });
    set.reviewDmEnabled = body.reviewDmEnabled;
  }
  if (Object.keys(set).length === 0) return NextResponse.json({ ok: false, error: 'no recognized fields' }, { status: 400 });
  await getDb().update(users).set(set).where(eq(users.id, id));
  return NextResponse.json({ ok: true, ...set });
}
