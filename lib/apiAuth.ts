// Resource-access seam for the API route handlers.
//
// Until now every team-gated route hand-rolled the same preamble:
//   const session = await auth();
//   const userId = session?.user?.id ?? null;
//   if (!userId) return 401 'sign in required';
//   const me = await getTeamMembership(slug, userId);   // or a raw teamMembers select
//   if (!me) return 403 'not a member';
//   if (me.role !== 'owner') return 403 'owner only';
// …copied across ~40 handlers, with the status codes and error strings drifting.
//
// These compose auth + the session id + membership/role into one call that
// returns either a typed context OR a ready NextResponse. The route does:
//   const m = await requireTeamMember(slug);
//   if (m instanceof NextResponse) return m;
//   // m.userId, m.role
// so the authorization contract lives in ONE place and the decision is a pure
// function testable without standing up a Request.

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTeamMembership } from '@/lib/teamSurface';

export interface SessionCtx {
  userId: string;
}
export interface TeamMemberCtx {
  userId: string;
  role: string;
}

// 401 if there's no signed-in session.
export async function requireSession(): Promise<SessionCtx | NextResponse> {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  return { userId };
}

// 401 if signed out; otherwise loads team membership.
//   - not a member  → 403 'not a member' (override to 404 via notMemberStatus
//     for routes that hide team existence from slug-enumeration, e.g. leave).
//   - role: 'owner' → additionally 403 'owner only' unless the member is owner.
export async function requireTeamMember(
  slug: string,
  opts: { role?: 'owner'; notMemberStatus?: 403 | 404 } = {},
): Promise<TeamMemberCtx | NextResponse> {
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const me = await getTeamMembership(slug, s.userId);
  if (!me) {
    return NextResponse.json({ ok: false, error: 'not a member' }, { status: opts.notMemberStatus ?? 403 });
  }
  if (opts.role === 'owner' && me.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 });
  }
  return { userId: s.userId, role: me.role };
}
