import Link from 'next/link';

export const metadata = {
  title: 'Privacy — KaraBuddy',
};

const section: React.CSSProperties = {
  marginBottom: 32,
};
const h2: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  margin: '0 0 8px',
  color: '#e6e6e6',
};
const p: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: '#c4c8d2',
  margin: '0 0 12px',
};
const muted: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: '#a0a8b8',
  margin: '0 0 12px',
};
const codeStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid #2e333c',
  borderRadius: 3,
  padding: '1px 6px',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  color: '#d6e7ff',
};
const list: React.CSSProperties = {
  margin: '0 0 12px',
  paddingLeft: 22,
  fontSize: 14,
  lineHeight: 1.6,
  color: '#c4c8d2',
};
const linkStyle: React.CSSProperties = { color: '#5da9ff', textDecoration: 'none' };

export default function PrivacyPage() {
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
      <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 600 }}>Privacy</h1>
      <p style={{ ...muted, marginBottom: 32 }}>
        Last updated: May 26, 2026. KaraBuddy is a fan project for{' '}
        <a href="https://karabast.net" target="_blank" rel="noreferrer" style={linkStyle}>karabast.net</a>{' '}
        replay capture and review. This page covers what data the webapp and Chrome extension collect,
        where it goes, and how to get rid of it.
      </p>

      <section style={section}>
        <h2 style={h2}>What data we collect</h2>

        <p style={p}><strong style={{ color: '#e6e6e6' }}>Install token.</strong> The KaraBuddy chrome extension generates an opaque random identifier (format: <code style={codeStyle}>kbx_&lt;uuid&gt;</code>) the first time it runs and stores it in <code style={codeStyle}>chrome.storage.local</code>. Every replay the extension uploads carries this token. It's how we attribute uploads when you haven&apos;t signed in.</p>

        <p style={p}><strong style={{ color: '#e6e6e6' }}>Replay payloads.</strong> When the extension finalizes a karabast.net match it uploads a JSON blob to karabuddy.app. The payload contains: the gameState frame history (deck contents for both players, card play sequence, in-game chat, player usernames, game timer state), and any tags you added mid-match. Payloads are stored in Vercel Blob; metadata (gameId, players, duration, action count, upload time, visibility) lives in a Postgres row that points at the blob. The extension also caches the most recent 50 replays in your browser&apos;s IndexedDB.</p>

        <p style={p}><strong style={{ color: '#e6e6e6' }}>Tags.</strong> Short text notes anchored to specific frames. Each tag stores the comment text, the frame index, the author&apos;s display name (your karabast username or an <code style={codeStyle}>anon-XXXX</code> handle generated once per browser), and the author&apos;s install token (so tag editing can be gated). Created via the extension mid-match or directly in the replay viewer at <code style={codeStyle}>/r/&lt;slug&gt;</code>.</p>

        <p style={p}><strong style={{ color: '#e6e6e6' }}>Account info (only if you sign in).</strong> Sign-in is optional. If you use it, Auth.js receives your Discord or Google profile via OAuth and stores: the provider name (<code style={codeStyle}>discord</code> or <code style={codeStyle}>google</code>), the provider&apos;s user ID, your email address (if the provider sends it), and your display name. Sessions are signed JWTs in an HTTP-only cookie.</p>

        <p style={p}><strong style={{ color: '#e6e6e6' }}>Karabast username claim (optional).</strong> If you set this in <code style={codeStyle}>/settings</code>, we use it to backfill ownership of historical replays where you appear as a player.</p>
      </section>

      <section style={section}>
        <h2 style={h2}>What we do NOT collect</h2>
        <ul style={list}>
          <li>Marketing or advertising cookies.</li>
          <li>Third-party analytics scripts (no Google Analytics, no Plausible, no tracking pixels).</li>
          <li>IP addresses, except in Vercel&apos;s standard request logs (retained per Vercel&apos;s terms — typically ~30 days).</li>
          <li>Anything you do on karabast.net beyond the WebSocket frames of matches the extension records — no DOM scraping, no input logging, no card-list snooping outside live matches.</li>
        </ul>
      </section>

      <section style={section}>
        <h2 style={h2}>Where it goes</h2>
        <ul style={list}>
          <li><strong style={{ color: '#e6e6e6' }}>Vercel</strong> — hosts the webapp, serves Vercel Blob (replay payload storage), and runs Vercel Edge Functions. Operates per their <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noreferrer" style={linkStyle}>privacy policy</a>.</li>
          <li><strong style={{ color: '#e6e6e6' }}>Neon</strong> — managed Postgres for metadata (replays table, tags table, users table, extension-token mappings). Operates per their <a href="https://neon.tech/privacy-policy" target="_blank" rel="noreferrer" style={linkStyle}>privacy policy</a>.</li>
          <li><strong style={{ color: '#e6e6e6' }}>Discord</strong> and <strong style={{ color: '#e6e6e6' }}>Google</strong> — OAuth providers, only if you sign in with one. We never see your password.</li>
        </ul>
      </section>

      <section style={section}>
        <h2 style={h2}>Replay visibility</h2>
        <p style={p}>
          Replays default to <strong style={{ color: '#e6e6e6' }}>unlisted</strong>: only accessible via the direct <code style={codeStyle}>/r/&lt;slug&gt;</code> URL. The slug is short but unguessable. You can flip a replay to <strong style={{ color: '#e6e6e6' }}>public</strong> in the viewer&apos;s Share menu, which makes it appear in the public browse list at <code style={codeStyle}>/replays?tab=public</code>.
        </p>
        <p style={muted}>
          Anyone with the link to an unlisted replay can view its full content (deck contents, chat, frame-by-frame state). Treat the link like a shareable link to a Google Doc — if you don&apos;t want strangers seeing it, don&apos;t share the URL.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>Retention</h2>
        <ul style={list}>
          <li>Replays + tags: kept indefinitely until you delete them or your account.</li>
          <li>Account: kept until you delete it (contact us — there&apos;s no self-serve account-delete UI yet).</li>
          <li>Local IndexedDB cache: capped at the 50 most recent replays per browser; oldest evicted automatically.</li>
          <li>Vercel + Neon backups: per those providers&apos; standard retention windows.</li>
        </ul>
      </section>

      <section style={section}>
        <h2 style={h2}>Your controls</h2>
        <ul style={list}>
          <li><strong style={{ color: '#e6e6e6' }}>Delete a replay:</strong> trash icon on the replay card at <code style={codeStyle}>/replays?tab=mine</code>.</li>
          <li><strong style={{ color: '#e6e6e6' }}>Delete a tag:</strong> ✕ button on the tag in the replay viewer.</li>
          <li><strong style={{ color: '#e6e6e6' }}>Stop the extension from capturing:</strong> disable or uninstall it from <code style={codeStyle}>chrome://extensions</code>. Any not-yet-uploaded recordings are lost.</li>
          <li><strong style={{ color: '#e6e6e6' }}>Sign out:</strong> menu in the top-right of the webapp.</li>
          <li><strong style={{ color: '#e6e6e6' }}>Anonymous mode:</strong> simply don&apos;t sign in. Uploads attribute to the install token only and aren&apos;t linked to a profile.</li>
          <li><strong style={{ color: '#e6e6e6' }}>Delete your account + everything attributed to it:</strong> email us — see contact below.</li>
        </ul>
      </section>

      <section style={section}>
        <h2 style={h2}>Contact</h2>
        <p style={p}>
          Privacy questions, deletion requests, or anything else:{' '}
          <a href="mailto:parkermos@gmail.com" style={linkStyle}>parkermos@gmail.com</a>.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>Affiliation</h2>
        <p style={muted}>
          KaraBuddy is a fan project. It is not affiliated with, endorsed by, or sponsored by Fantasy Flight Games, Asmodee, or Lucasfilm. Star Wars: Unlimited and all associated marks belong to their respective owners.
        </p>
      </section>

      <p style={{ ...muted, marginTop: 48 }}>
        <Link href="/" style={linkStyle}>← Back home</Link>
      </p>
    </main>
  );
}
