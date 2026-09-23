'use client';

import { useEffect, useState, type ReactNode } from 'react';

// Hides the "Move this team to SWU Forge" card until a localStorage key is set.
//
// ⚠ This is NOT a security boundary and is not pretending to be one — it only
// keeps the entry point out of the way while the feature is being shaken out.
// What actually protects the move is owners-only, enforced on the server at
// /teams/<slug>/move and at POST /api/teams/<slug>/forge-migration, plus the
// shared secret without which neither exists.
//
// Turn it on with `localStorage.setItem('kb:forge-move', '1')` in devtools, or
// by loading team settings once with `?forge-move=1` (which writes the key, so
// it sticks). Off renders nothing at all — no placeholder, no note, no log.
const FLAG_KEY = 'kb:forge-move';

export function ForgeMoveFlag({ children }: { children: ReactNode }) {
  // Starts false so the server-rendered HTML and the first client paint agree,
  // and so storage being unreadable (private mode, blocked site data) leaves
  // the card hidden rather than throwing.
  const [on, setOn] = useState(false);

  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('forge-move') === '1') {
        window.localStorage.setItem(FLAG_KEY, '1');
      }
      setOn(window.localStorage.getItem(FLAG_KEY) === '1');
    } catch {
      // Stay hidden, silently.
    }
  }, []);

  return on ? <>{children}</> : null;
}
