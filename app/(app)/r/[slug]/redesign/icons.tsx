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
  play: svg(<polygon points="7 4 20 12 7 20" />, { fill: true }),
  pause: svg(<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>, { fill: true }),
  jump: svg(<><path d="M12 21.5s-6.5-5.6-6.5-10.5a6.5 6.5 0 1 1 13 0c0 4.9-6.5 10.5-6.5 10.5Z" /><circle cx="12" cy="11" r="2.3" /></>), // map-pin — the original jump-to glyph
  clip: svg(<><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><line x1="8.1" y1="7.4" x2="20" y2="17" /><line x1="8.1" y1="16.6" x2="20" y2="7" /></>), // scissors
  clips: svg(<><rect x="3" y="6" width="18" height="12" rx="2" /><line x1="8" y1="6" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="18" /></>), // film strip
  sidebar: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="15" y1="4" x2="15" y2="20" /></>),
  share: svg(<><circle cx="6" cy="12" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><line x1="8.1" y1="10.9" x2="15.9" y2="7.1" /><line x1="8.1" y1="13.1" x2="15.9" y2="16.9" /></>),
};
