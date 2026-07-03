import type { ReactNode } from 'react';

// B216 redesign — minimal line icons (glassy/iOS feel) shared by the rail and the
// sidebar view selector. currentColor so the caller controls tint.
const svg = (children: ReactNode, opts?: { fill?: boolean }): ReactNode => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill={opts?.fill ? 'currentColor' : 'none'} stroke={opts?.fill ? 'none' : 'currentColor'} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);

export const Icon: Record<string, ReactNode> = {
  log: svg(<><line x1="8" y1="7" x2="20" y2="7" /><line x1="8" y1="12" x2="20" y2="12" /><line x1="8" y1="17" x2="15" y2="17" /><circle cx="4.5" cy="7" r="0.6" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="0.6" fill="currentColor" stroke="none" /><circle cx="4.5" cy="17" r="0.6" fill="currentColor" stroke="none" /></>),
  matchup: svg(<><polyline points="10 6 5 12 10 18" /><polyline points="14 6 19 12 14 18" /></>),
  decks: svg(<><rect x="3" y="7" width="12" height="14" rx="2" /><rect x="9" y="3" width="12" height="14" rx="2" /></>),
  sideboard: svg(<><rect x="2" y="2" width="8.5" height="11" rx="1.4" /><rect x="13.5" y="11" width="8.5" height="11" rx="1.4" /><path d="M14.5 6.5l2.2 2.2-2.2 2.2" /><path d="M9.5 17.5l-2.2-2.2 2.2-2.2" /></>), // two cards swapping (diagonal + circular chevrons)
  flip: svg(<><path d="M8 20V5" /><path d="M4.5 8.5 8 5l3.5 3.5" /><path d="M16 4v15" /><path d="M12.5 15.5 16 19l3.5-3.5" /></>), // vertical swap — the board mirrors top/bottom
  eye: svg(<><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" /><circle cx="12" cy="12" r="2.8" /></>),
  play: svg(<polygon points="7 4 20 12 7 20" />, { fill: true }),
  pause: svg(<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>, { fill: true }),
  jump: svg(<><path d="M12 21.5s-6.5-5.6-6.5-10.5a6.5 6.5 0 1 1 13 0c0 4.9-6.5 10.5-6.5 10.5Z" /><circle cx="12" cy="11" r="2.3" /></>), // map-pin — the original jump-to glyph
  clip: svg(<><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><line x1="8.1" y1="7.4" x2="20" y2="17" /><line x1="8.1" y1="16.6" x2="20" y2="7" /></>), // scissors
  clips: svg(<><rect x="3" y="6" width="18" height="12" rx="2" /><line x1="8" y1="6" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="18" /></>), // film strip
  sidebar: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="15" y1="4" x2="15" y2="20" /></>),
  share: svg(<><circle cx="6" cy="12" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><line x1="8.1" y1="10.9" x2="15.9" y2="7.1" /><line x1="8.1" y1="13.1" x2="15.9" y2="16.9" /></>),
  messages: svg(<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />),
  review: svg(<><circle cx="12" cy="12" r="9" /><path d="M8.2 12.4l2.6 2.6 4.8-5.4" /></>),
  // FILLED gear (Material settings silhouette): stroked cogs go mushy at icon
  // sizes — teeth merge under anti-aliasing and read as lopsided. A single
  // filled region renders crisp + symmetric (like the play/pause fills).
  gear: svg(<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />, { fill: true }),
};
