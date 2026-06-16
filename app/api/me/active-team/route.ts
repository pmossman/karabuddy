import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTeamMembership } from '@/lib/teamSurface';
import { ACTIVE_TEAM_COOKIE } from '@/lib/activeTeam';

export const runtime = 'nodejs';

// POST /api/me/active-team  { slug }
// Persists the caller's active team in the kb_team cookie. Membership-gated:
// a slug the caller isn't in is rejected (403) so the cookie can never point
// at a team they can't see. Writes live here because cookies().set is illegal
// during RSC render — the resolver (lib/activeTeam) only reads.
export async function POST(req: Request) {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }

  let slug: unknown;
  try {
    ({ slug } = await req.json());
  } catch {
    slug = undefined;
  }
  if (typeof slug !== 'string' || !slug) {
    return NextResponse.json({ ok: false, error: 'slug required' }, { status: 400 });
  }

  const membership = await getTeamMembership(slug, userId);
  if (!membership) {
    return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true, slug });
  res.cookies.set(ACTIVE_TEAM_COOKIE, slug, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // ~1 year
  });
  return res;
}
