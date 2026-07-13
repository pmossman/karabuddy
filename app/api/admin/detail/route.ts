import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAdmin } from '@/lib/admin';
import { featureDetail, teamDetail, userDetail } from '@/lib/adminDetail';

// B157-followup: on-demand drill-down for the admin dashboard. Admin-gated (same
// allowlist as /admin); non-admins get 404 so the route stays invisible.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const kind = sp.get('kind');
  const id = sp.get('id') ?? '';

  try {
    if (kind === 'feature') {
      const d = await featureDetail(id);
      return d ? NextResponse.json(d) : NextResponse.json({ error: 'unknown feature' }, { status: 400 });
    }
    if (kind === 'team') {
      const d = await teamDetail(id);
      return d ? NextResponse.json(d) : NextResponse.json({ error: 'unknown team' }, { status: 404 });
    }
    if (kind === 'user') {
      const d = await userDetail(id);
      return d ? NextResponse.json(d) : NextResponse.json({ error: 'unknown user' }, { status: 404 });
    }
    return NextResponse.json({ error: 'bad kind' }, { status: 400 });
  } catch (e) {
    console.error('[admin/detail] failed', { kind, id, e });
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
