import Link from 'next/link';

// Minimal sitewide footer. Keeps the privacy link discoverable (required
// for Chrome Web Store submission + general good practice) without taking
// up much vertical space. Lives in (app) layout — the immersive replay
// viewer at /r/[slug] skips it.
export function Footer() {
  return (
    <footer
      style={{
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
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>Fan project for{' '}
          <a href="https://karabast.net" target="_blank" rel="noreferrer" style={linkStyle}>karabast.net</a>.
          {' '}Not affiliated with FFG / Asmodee / Lucasfilm.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <Link href="/privacy" prefetch={false} style={linkStyle}>Privacy</Link>
        <Link href="/install" prefetch={false} style={linkStyle}>Install</Link>
        <a
          href="https://github.com/pmossman/karabuddy"
          target="_blank"
          rel="noreferrer"
          style={linkStyle}
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}

const linkStyle: React.CSSProperties = { color: '#a0a8b8', textDecoration: 'none' };
