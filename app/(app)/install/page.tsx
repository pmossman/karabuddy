import Link from 'next/link';

// Install walkthrough for the Chrome extension. Until the Chrome Web
// Store listing exists, users have to side-load via "Load unpacked".
// Once the store listing ships, swap step 1 for the marketplace link
// and collapse the rest behind a "manual install" disclosure.
export default function InstallPage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '40px auto 80px',
        padding: '0 28px',
        color: '#e6e6e6',
        fontFamily: 'var(--font-barlow), sans-serif',
      }}
    >
      <section style={{ marginBottom: 28 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 600 }}>
          Install the KaraBuddy extension
        </h1>
        <p style={{ fontSize: 14, color: '#a0a8b8', lineHeight: 1.6, margin: 0 }}>
          Records your karabast.net matches, lets you scrub through past replays frame-by-frame, drop
          tags on key moments, and run solo deck-test sessions in one window. Currently Chrome (and
          other Chromium browsers) only — see below.
        </p>
      </section>

      <section
        style={{
          padding: 24,
          background: 'rgba(17,20,26,0.65)',
          border: '1px solid #2e333c',
          borderRadius: 10,
          marginBottom: 20,
        }}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>Chrome / Chromium</h2>
        <ol
          style={{
            margin: 0,
            paddingLeft: 22,
            fontSize: 14,
            color: '#d4d8e0',
            lineHeight: 1.7,
          }}
        >
          <li style={{ marginBottom: 10 }}>
            <strong style={{ color: '#e6e6e6' }}>Download the extension.</strong>{' '}
            <span style={{ color: '#a0a8b8' }}>
              Grab the latest <code style={code}>karabuddy-extension-&lt;version&gt;.zip</code> from{' '}
              <a
                href="https://github.com/pmossman/karabuddy/releases"
                target="_blank"
                rel="noreferrer"
                style={linkStyle}
              >
                GitHub Releases
              </a>
              . No release published yet? Clone{' '}
              <a
                href="https://github.com/pmossman/karabuddy"
                target="_blank"
                rel="noreferrer"
                style={linkStyle}
              >
                pmossman/karabuddy
              </a>{' '}
              and use the <code style={code}>extension/</code> directory directly — skip step 2.
            </span>
          </li>
          <li style={{ marginBottom: 10 }}>
            <strong style={{ color: '#e6e6e6' }}>Unzip it.</strong>{' '}
            <span style={{ color: '#a0a8b8' }}>
              Anywhere stable — Chrome reads the files directly from disk, so don&apos;t move or
              delete the folder after installing.
            </span>
          </li>
          <li style={{ marginBottom: 10 }}>
            <strong style={{ color: '#e6e6e6' }}>
              Open{' '}
              <code style={code}>chrome://extensions</code>
            </strong>{' '}
            <span style={{ color: '#a0a8b8' }}>
              in a new tab (paste it into the URL bar — Chrome blocks links).
            </span>
          </li>
          <li style={{ marginBottom: 10 }}>
            <strong style={{ color: '#e6e6e6' }}>Toggle Developer mode</strong>{' '}
            <span style={{ color: '#a0a8b8' }}>
              in the top-right corner of that page.
            </span>
          </li>
          <li style={{ marginBottom: 10 }}>
            <strong style={{ color: '#e6e6e6' }}>Click &ldquo;Load unpacked&rdquo;</strong>{' '}
            <span style={{ color: '#a0a8b8' }}>
              (top-left, now visible because Developer mode is on).
            </span>
          </li>
          <li style={{ marginBottom: 10 }}>
            <strong style={{ color: '#e6e6e6' }}>Select the unzipped folder</strong>{' '}
            <span style={{ color: '#a0a8b8' }}>
              — the directory containing <code style={code}>manifest.json</code>. If you cloned the
              repo, that&apos;s <code style={code}>karabuddy/extension</code>.
            </span>
          </li>
          <li>
            <strong style={{ color: '#e6e6e6' }}>Pin it to the toolbar.</strong>{' '}
            <span style={{ color: '#a0a8b8' }}>
              Click the puzzle-piece icon in Chrome&apos;s toolbar, find KaraBuddy, click the pin.
              You&apos;ll use the popup to start/stop recording and toggle solo mode.
            </span>
          </li>
        </ol>
      </section>

      <section
        style={{
          padding: 20,
          background: 'rgba(17,20,26,0.4)',
          border: '1px solid #2e333c',
          borderRadius: 10,
          marginBottom: 20,
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#a0a8b8' }}>
          Once it&apos;s installed
        </h2>
        <p style={{ fontSize: 13, color: '#a0a8b8', lineHeight: 1.6, margin: '0 0 8px' }}>
          Visit{' '}
          <a href="https://karabast.net" target="_blank" rel="noreferrer" style={linkStyle}>
            karabast.net
          </a>{' '}
          and start a game — recording is automatic, uploads land on your{' '}
          <Link href="/replays?tab=mine" style={linkStyle}>
            My replays
          </Link>{' '}
          tab. To attribute past uploads to your account, run the one-time{' '}
          <Link href="/claim" style={linkStyle}>
            /claim
          </Link>{' '}
          flow.
        </p>
      </section>

      <section
        style={{
          padding: 20,
          border: '1px dashed #2e333c',
          borderRadius: 10,
          color: '#6c7588',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: '#a0a8b8' }}>Firefox / Edge support: coming later.</strong> The MV3
        manifest needs minor tweaks (a <code style={code}>browser_specific_settings</code> block for
        Firefox; manifest is already Chromium-MV3 so Edge mostly &ldquo;just works&rdquo; once we
        publish an .xpi / sign for the Edge Add-ons store). Open an issue if you want to help.
      </section>
    </main>
  );
}

const linkStyle: React.CSSProperties = { color: '#5a8cff', textDecoration: 'none' };
const code: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.9em',
  padding: '1px 5px',
  background: 'rgba(74, 124, 255, 0.1)',
  border: '1px solid rgba(74, 124, 255, 0.2)',
  borderRadius: 4,
  color: '#c4d4ff',
};
