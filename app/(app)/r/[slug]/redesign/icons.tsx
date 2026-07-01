import type { ReactNode } from 'react';

// B216 redesign — minimal line icons (glassy/iOS feel) shared by the rail and the
// sidebar view selector. currentColor so the caller controls tint.
const svg = (children: ReactNode, opts?: { fill?: boolean }): ReactNode => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill={opts?.fill ? 'currentColor' : 'none'} stroke={opts?.fill ? 'none' : 'currentColor'} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);

export const Icon: Record<string, ReactNode> = {
  tag: svg(<><path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" /></>),
  log: svg(<><line x1="8" y1="7" x2="20" y2="7" /><line x1="8" y1="12" x2="20" y2="12" /><line x1="8" y1="17" x2="15" y2="17" /><circle cx="4.5" cy="7" r="0.6" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="0.6" fill="currentColor" stroke="none" /><circle cx="4.5" cy="17" r="0.6" fill="currentColor" stroke="none" /></>),
  matchup: svg(<><polyline points="10 6 5 12 10 18" /><polyline points="14 6 19 12 14 18" /></>),
  decks: svg(<><rect x="3" y="7" width="12" height="14" rx="2" /><rect x="9" y="3" width="12" height="14" rx="2" /></>),
  sideboard: svg(<><rect x="2" y="6" width="5.5" height="12" rx="1.3" /><rect x="16.5" y="6" width="5.5" height="12" rx="1.3" /><path d="M8.5 10h6" /><path d="M13 8.5l2 1.5-2 1.5" /><path d="M15.5 14h-6" /><path d="M11 12.5l-2 1.5 2 1.5" /></>), // two cards swapping
  play: svg(<polygon points="7 4 20 12 7 20" />, { fill: true }),
  pause: svg(<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>, { fill: true }),
  jump: svg(<><path d="M12 21.5s-6.5-5.6-6.5-10.5a6.5 6.5 0 1 1 13 0c0 4.9-6.5 10.5-6.5 10.5Z" /><circle cx="12" cy="11" r="2.3" /></>), // map-pin — the original jump-to glyph
  clip: svg(<><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><line x1="8.1" y1="7.4" x2="20" y2="17" /><line x1="8.1" y1="16.6" x2="20" y2="7" /></>), // scissors
  clips: svg(<><rect x="3" y="6" width="18" height="12" rx="2" /><line x1="8" y1="6" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="18" /></>), // film strip
  sidebar: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="15" y1="4" x2="15" y2="20" /></>),
  share: svg(<><circle cx="6" cy="12" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><line x1="8.1" y1="10.9" x2="15.9" y2="7.1" /><line x1="8.1" y1="13.1" x2="15.9" y2="16.9" /></>),
  messages: svg(<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />),
  review: svg(<><circle cx="12" cy="12" r="9" /><path d="M8.2 12.4l2.6 2.6 4.8-5.4" /></>),
  gear: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>),
};
