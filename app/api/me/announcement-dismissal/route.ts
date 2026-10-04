import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/apiAuth';
import { dismissAnnouncement } from '@/lib/announcements';
import { FORGE_ANNOUNCEMENT_VERSION } from '@/app/_components/forgeAnnouncement/constants';

export const runtime = 'nodejs';

// POST /api/me/announcement-dismissal  { version }
// Records that the caller dismissed this announcement version. Never lowers
// a newer dismissal.
export async function POST(req: Request) {
  const s = await requireSession();
  if (s instanceof NextResponse) return s;

  const body = await req.json().catch(() => ({}));
  const version = body?.version;
  if (!Number.isInteger(version) || version < 1 || version > FORGE_ANNOUNCEMENT_VERSION) {
    return NextResponse.json({ ok: false, error: 'unknown version' }, { status: 400 });
  }

  await dismissAnnouncement(s.userId, version);
  return NextResponse.json({ ok: true });
}
