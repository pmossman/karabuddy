import Link from 'next/link';

// Install page. Primary path is the Chrome Web Store listing (a styled CTA —
// Google retired its official "Available in the Chrome Web Store" badge images,
// so a button is the current convention). Manual / from-source side-loading is
// kept for unsupported browsers + contributors, but demoted behind a disclosure.
const CHROME_WEBSTORE_URL = 'https://chromewebstore.google.com/detail/bfpaaohhomgmpallbfnbefkkdhoibfcp';

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
      <section style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 600 }}>
          Install the KaraBuddy extension
        </h1>
        <p style={{ fontSize: 14, color: '#a0a8b8', lineHeight: 1.6, margin: 0 }}>
          Records your karabast.net matches, lets you scrub through past replays frame-by-frame, drop
          tags on key moments, and run solo deck-test sessions in one window. Works in Chrome and
          other Chromium browsers (Edge, Brave, Arc); Firefox is on the way.
        </p>
      </section>

      {/* Primary CTAs */}
      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 28 }}>
        <a
          href={CHROME_WEBSTORE_URL}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 22px',
            borderRadius: 12,
            background: 'linear-gradient(180deg, #4d9dff, #3b7fe0)',
            border: '1px solid #6cb0ff',
            boxShadow: '0 4px 16px rgba(77,157,255,0.35)',
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 700,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/browser-chrome.svg" alt="" width={26} height={26} />
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontSize: 16 }}>Add to Chrome</span>
            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>
              Free · Chrome Web Store
            </span>
          </span>
        </a>

        <span
          aria-disabled="true"
          title="The Firefox add-on is on its way to addons.mozilla.org"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 22px',
            borderRadius: 12,
            background: 'rgba(17,20,26,0.6)',
            border: '1px dashed #3a4150',
            color: '#8b93a5',
            fontWeight: 700,
            cursor: 'not-allowed',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/browser-firefox.svg" alt="" width={26} height={26} style={{ opacity: 0.5 }} />
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontSize: 16 }}>Add to Firefox</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#8b6d3a' }}>
              Coming soon
            </span>
          </span>
        </span>
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

      {/* Manual / from-source install — demoted behind a disclosure. */}
      <details
        style={{
          padding: '14px 20px',
          background: 'rgba(17,20,26,0.4)',
          border: '1px solid #2e333c',
          borderRadius: 10,
        }}
      >
        <summary
          style={{
            cursor: 'pointer',
            fontSize: 13.5,
            fontWeight: 600,
            color: '#a0a8b8',
            listStyle: 'none',
          }}
        >
          Advanced: side-load a pre-release or build from source →
        </summary>
        <p style={{ fontSize: 13, color: '#8b93a5', lineHeight: 1.6, margin: '12px 0 4px' }}>
          Most people should just use the Chrome Web Store button above. This path is for running a
          pre-release build, testing on an unsupported browser, or hacking on the extension itself. It
          loads the unpacked extension straight from disk — Chrome reads the files in place, so keep
          the folder where it is after installing.
        </p>
        <ol
          style={{
            margin: '8px 0 0',
            paddingLeft: 22,
            fontSize: 13.5,
            color: '#d4d8e0',
            lineHeight: 1.7,
          }}
        >
          <li style={{ marginBottom: 10 }}>
            <strong style={{ color: '#e6e6e6' }}>Get the extension files.</strong>{' '}
            <span style={{ color: '#a0a8b8' }}>
              Grab the latest <code style={code}>karabuddy-extension-&lt;version&gt;.zip</code> from{' '}
              <a
                href="https://github.com/pmossman/karabuddy/releases"
                target="_blank"
                rel="noreferrer"
                style={linkStyle}
              >
                GitHub Releases
              </a>{' '}
              and unzip it, or clone{' '}
              <a
                href="https://github.com/pmossman/karabuddy"
                target="_blank"
                rel="noreferrer"
                style={linkStyle}
              >
                pmossman/karabuddy
              </a>{' '}
              and use the <code style={code}>extension/</code> directory directly.
            </span>
          </li>
          <li style={{ marginBottom: 10 }}>
            <strong style={{ color: '#e6e6e6' }}>
              Open <code style={code}>chrome://extensions</code>
            </strong>{' '}
            <span style={{ color: '#a0a8b8' }}>
              in a new tab (paste it into the URL bar — Chrome blocks links to it).
            </span>
          </li>
          <li style={{ marginBottom: 10 }}>
            <strong style={{ color: '#e6e6e6' }}>Toggle Developer mode</strong>{' '}
            <span style={{ color: '#a0a8b8' }}>in the top-right corner of that page.</span>
          </li>
          <li style={{ marginBottom: 10 }}>
            <strong style={{ color: '#e6e6e6' }}>Click &ldquo;Load unpacked&rdquo;</strong>{' '}
            <span style={{ color: '#a0a8b8' }}>
              (top-left, now visible) and select the folder containing{' '}
              <code style={code}>manifest.json</code> — for a clone that&apos;s{' '}
              <code style={code}>karabuddy/extension</code>.
            </span>
          </li>
          <li>
            <strong style={{ color: '#e6e6e6' }}>Pin it to the toolbar.</strong>{' '}
            <span style={{ color: '#a0a8b8' }}>
              Click the puzzle-piece icon in Chrome&apos;s toolbar, find KaraBuddy, click the pin. The
              popup starts/stops recording and toggles solo mode.
            </span>
          </li>
        </ol>
      </details>
    </main>
  );
}

const linkStyle: React.CSSProperties = { color: '#5db4ff', textDecoration: 'none' };
const code: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.9em',
  padding: '1px 5px',
  background: 'rgba(77, 157, 255, 0.1)',
  border: '1px solid rgba(77, 157, 255, 0.2)',
  borderRadius: 4,
  color: '#c4d4ff',
};
