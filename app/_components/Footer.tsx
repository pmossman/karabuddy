'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Minimal sitewide footer, rendered in the (app) layout for every page.
//
// Community/external links (GitHub, Discord, Ko-fi) sit here as consistent
// icon+label links rather than in the header — low-key, so the support ask
// never reads as prominent / greedy. Ko-fi is the upgrade seam for a real
// in-app supporter program later.
export function Footer() {
  // The immersive playback views (replay /r/[slug], clip /c/[slug]) fill the
  // viewport — there the footer should sit BELOW the fold (scroll to reach it)
  // rather than pinned over the board. Everywhere else it's sticky.
  const pathname = usePathname();
  const immersive = /^\/(r|c)\/[^/]+$/.test(pathname);
  return (
    <footer
      // Sticky on DESKTOP only (non-immersive): pinned to the viewport bottom
      // while long pages scroll, resting at the page end on short ones. On mobile
      // (≤860px, the app-shell breakpoint) a pinned footer permanently eats scarce
      // vertical space + covers content, so it drops to normal flow (scroll to it).
      className={immersive ? undefined : 'kb-footer-sticky'}
      style={{
        background: '#0b0e13',
        borderTop: '1px solid #2e333c',
        padding: '20px 28px',
        color: '#6c7588',
        fontSize: 12,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <style>{`
        .kb-footer-sticky { position: sticky; bottom: 0; z-index: 20; }
        @media (max-width: 860px) { .kb-footer-sticky { position: static; } }
      `}</style>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>Fan project for{' '}
          <a href="https://karabast.net" target="_blank" rel="noreferrer" style={linkStyle}>karabast.net</a>.
          {' '}Not affiliated with FFG / Asmodee / Lucasfilm.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <Link href="/privacy" prefetch={false} style={linkStyle}>Privacy</Link>
        <Link href="/install" prefetch={false} style={linkStyle}>Install</Link>
        <IconLink href="https://github.com/pmossman/karabuddy" label="karabuddy on GitHub" icon={<GitHubIcon />}>GitHub</IconLink>
        <IconLink href="https://discord.gg/DnbpNa6yzv" label="Join our Discord" icon={<DiscordIcon />}>Join</IconLink>
        <IconLink href="https://ko-fi.com/karabuddy" label="Support karabuddy on Ko-fi" icon={<HeartIcon />}>Support</IconLink>
      </div>
    </footer>
  );
}

// A consistent external icon+label link — same sizing/spacing for every footer
// glyph so they read as one set.
function IconLink({ href, label, icon, children }: { href: string; label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      style={{ ...linkStyle, display: 'inline-flex', alignItems: 'center', gap: 5 }}
    >
      {icon}
      {children}
    </a>
  );
}

const GitHubIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

const DiscordIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
  </svg>
);

const HeartIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
);

const linkStyle: React.CSSProperties = { color: '#a0a8b8', textDecoration: 'none' };
