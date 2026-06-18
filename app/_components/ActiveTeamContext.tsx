'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { TeamRef } from '@/lib/activeTeam';

// Active-team state, lifted OUT of <Sidebar> and into the (app) layout.
//
// Why a layout-level provider instead of sidebar-local state: the (app) layout
// does NOT re-render on soft-nav, so its server-resolved `active` prop freezes at
// first page load (your default, first-joined team). And <AppShell> renders a
// structurally different tree for the immersive viewer (the overlay sidebar) vs
// team pages (the column sidebar) — so navigating INTO /r/[slug] unmounts one
// sidebar and mounts the other, which would re-seed active from that stale prop
// and snap you back to the default team. This provider lives above AppShell, so
// it survives the column↔overlay remount and keeps the active team stable as you
// move around (the reported bug: pick Team A, open its replay, hamburger showed
// your first-joined team).
//
// Active follows the URL on /teams/<slug> (mirrors middleware's cookie sync). A
// replay is just content — viewing one does NOT change your active team, so the
// team you picked is still active when you come back. The kb_team COOKIE stays
// the durable home; this is the live, in-session view of it.

interface ActiveTeamCtx {
  active: TeamRef | null;
  teams: TeamRef[];
}

const ActiveTeamContext = createContext<ActiveTeamCtx | null>(null);

export function ActiveTeamProvider({
  active: initialActive,
  teams,
  children,
}: {
  active: TeamRef | null;
  teams: TeamRef[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [slug, setSlug] = useState<string | null>(initialActive?.slug ?? null);

  // Track the team you're viewing on /teams/<slug> (the cookie that middleware
  // sets is only read on hard loads; this keeps the live UI in lockstep too).
  useEffect(() => {
    const m = pathname.match(/^\/teams\/([^/]+)/);
    const s = m?.[1];
    if (s && s !== 'join' && teams.some((t) => t.slug === s)) setSlug(s);
  }, [pathname, teams]);

  const active = teams.find((t) => t.slug === slug) ?? initialActive ?? null;

  return (
    <ActiveTeamContext.Provider value={{ active, teams }}>
      {children}
    </ActiveTeamContext.Provider>
  );
}

export function useActiveTeam(): ActiveTeamCtx {
  const ctx = useContext(ActiveTeamContext);
  if (!ctx) throw new Error('useActiveTeam must be used within <ActiveTeamProvider>');
  return ctx;
}
