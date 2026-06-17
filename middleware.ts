import { NextResponse, type NextRequest } from 'next/server';

// Keep the active team (the kb_team cookie the sidebar resolves from) in lockstep
// with the team page you're actually viewing. Viewing /teams/<slug> — however you
// got there (sidebar, /teams list, a bookmark, a pasted URL) — makes <slug> the
// active team, so the sidebar switcher and the page can never disagree.
//
// This runs before render and updates BOTH the incoming request (so this same
// render's resolveActiveTeam sees the new slug) and the response (so the browser
// persists it). No membership check here on purpose: resolveActiveTeam re-
// validates membership on every read and harmlessly clamps a non-member slug, so
// this stays an optimistic UX sync, not a security boundary.
const ACTIVE_TEAM_COOKIE = 'kb_team';

export function middleware(request: NextRequest) {
  const m = request.nextUrl.pathname.match(/^\/teams\/([^/]+)(?:\/.*)?$/);
  const slug = m?.[1];
  // No slug (the /teams list) or the join flow → leave the active team alone.
  if (!slug || slug === 'join') return NextResponse.next();
  if (request.cookies.get(ACTIVE_TEAM_COOKIE)?.value === slug) return NextResponse.next();

  // Update the request cookie so THIS render resolves <slug> as active...
  request.cookies.set(ACTIVE_TEAM_COOKIE, slug);
  const response = NextResponse.next({ request });
  // ...and persist it on the response for subsequent navigations.
  response.cookies.set(ACTIVE_TEAM_COOKIE, slug, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export const config = {
  matcher: '/teams/:path*',
};
