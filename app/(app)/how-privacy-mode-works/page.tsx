import Link from 'next/link';
import { Panel } from '@/app/_components/Panel';
import { tokens } from '@/app/_theme/karabuddyTokens';

export const metadata = {
  title: 'How private mode works · KaraBuddy',
  description:
    'How KaraBuddy private teams keep replays end-to-end encrypted — not even the KaraBuddy team can read them — and how to verify it yourself.',
};

const GITHUB = 'https://github.com/pmossman/karabuddy';

const main: React.CSSProperties = {
  maxWidth: 760,
  margin: '40px auto 96px',
  padding: '0 28px',
  color: '#e6ebf2',
  fontFamily: 'var(--font-barlow), sans-serif',
  lineHeight: 1.6,
};
const eyebrow: React.CSSProperties = { color: tokens.led.on, fontSize: 12, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' };
const h2: React.CSSProperties = { fontSize: 21, fontWeight: 700, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 9 };
const p: React.CSSProperties = { margin: '0 0 12px', fontSize: 15, color: '#c2c9d6' };
const strong: React.CSSProperties = { color: '#e6ebf2', fontWeight: 700 };
const link: React.CSSProperties = { color: tokens.color.accentBright, textDecoration: 'none' };
const code: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13, color: '#9fe6ff', background: 'rgba(77,210,255,0.08)', padding: '1px 5px', borderRadius: 4 };
const sectionGap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18, marginTop: 28 };
const trackTitle: React.CSSProperties = { fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: tokens.led.on, marginBottom: 12 };
const trackCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 };

// Which surface a step happens on — the whole point of the visual is to show
// users when they're on the KaraBuddy site vs. inside the extension.
const SURFACE = {
  site: { icon: '🌐', label: 'KaraBuddy site', color: '#5db4ff', bg: 'rgba(77,157,255,0.12)', border: 'rgba(77,157,255,0.4)' },
  ext: { icon: '🧩', label: 'Extension', color: '#9fe6ff', bg: 'rgba(77,210,255,0.12)', border: 'rgba(77,210,255,0.4)' },
} as const;

function Badge({ surface }: { surface: 'site' | 'ext' }) {
  const s = SURFACE[surface];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: s.color, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
      {s.icon} {s.label}
    </span>
  );
}

function TrackStep({ n, surface, children }: { n: number; surface: 'site' | 'ext'; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 auto', width: 22, height: 22, borderRadius: '50%', border: `1.5px solid ${tokens.color.primary}`, color: tokens.led.on, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>{n}</div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <Badge surface={surface} />
        <div style={{ fontSize: 13.5, color: '#bcc4d0', lineHeight: 1.45 }}>{children}</div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 auto', width: 30, height: 30, borderRadius: '50%', border: `1.5px solid ${tokens.color.primary}`, color: tokens.led.on, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, boxShadow: '0 0 10px rgba(77,210,255,0.18)' }}>{n}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: '#e6ebf2', marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 14.5, color: '#a8b0bd' }}>{children}</div>
      </div>
    </div>
  );
}

export default function HowPrivacyModeWorksPage() {
  return (
    <main style={main}>
      <span style={eyebrow}>Private teams</span>
      <h1 style={{ margin: '6px 0 10px', fontSize: 34, fontWeight: 800, letterSpacing: '-0.01em' }}>
        🔒 End-to-end encrypted team replays
      </h1>
      <p style={{ fontSize: 17, color: '#aeb6c2', margin: '0 0 8px' }}>
        Competitive teams can turn on <strong style={strong}>private mode</strong> so their replays, comments, and decks
        are encrypted in your browser before they ever reach KaraBuddy. We store only ciphertext —{' '}
        <strong style={strong}>not even the KaraBuddy team can read them.</strong>
      </p>

      <div style={sectionGap}>
        <Panel>
          <h2 style={h2}>How it works</h2>
          <p style={p}>
            Private mode uses real client-side end-to-end encryption (AES-256-GCM). The encryption key is a secret your
            team holds — KaraBuddy never receives it.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
            <Step n={1} title="Your team has a secret key">
              A team lead generates it once (in the extension) and shares it with teammates out-of-band — over Signal,
              a password manager, in person. KaraBuddy is never in that loop.
            </Step>
            <Step n={2} title="Your browser encrypts before upload">
              When you record a match, the extension encrypts the replay, its matchup summary, and every comment with
              your team key — on your machine — and uploads only the ciphertext.
            </Step>
            <Step n={3} title="The server stores only ciphertext">
              KaraBuddy keeps the encrypted blob plus a non-secret <em>fingerprint</em> of the key (to know which key a
              replay needs). It can&apos;t read the contents and never has the key to try.
            </Step>
            <Step n={4} title="Teammates decrypt locally">
              When a teammate opens the replay, their extension decrypts it in their browser with the team key. The
              decrypted data never goes back to the server.
            </Step>
          </div>
        </Panel>

        <Panel>
          <h2 style={h2}>Setup at a glance</h2>
          <p style={p}>
            Two roles, two places. The <Badge surface="site" /> is where you start private mode and watch your replays;
            the <Badge surface="ext" /> holds your team key, turns encryption on, and does the encrypting. The key lives
            <strong style={strong}> only in the extension</strong> — never on the site.
          </p>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 14 }}>
            <div id="for-owners" style={{ flex: '1 1 260px', minWidth: 0, scrollMarginTop: 80 }}>
              <div style={trackTitle}>Team owner</div>
              <div style={trackCol}>
                <TrackStep n={1} surface="site">Create your team, then open <strong style={strong}>Settings → Privacy &amp; encryption</strong>.</TrackStep>
                <TrackStep n={2} surface="ext">Click <strong style={strong}>Make this team private</strong> — it opens the extension&apos;s key manager for this team.</TrackStep>
                <TrackStep n={3} surface="ext">Hit <strong style={strong}>Generate key &amp; turn on private mode</strong> — that creates the team key on your device <em>and</em> switches encryption on, in one step.</TrackStep>
                <TrackStep n={4} surface="ext">Copy the key and send it to teammates out-of-band (Signal, a password manager); you can show it again anytime. Then watch the <strong style={strong}>readiness roster</strong> on the team page as they set up.</TrackStep>
              </div>
            </div>
            <div id="for-members" style={{ flex: '1 1 260px', minWidth: 0, scrollMarginTop: 80 }}>
              <div style={trackTitle}>Team member</div>
              <div style={trackCol}>
                <TrackStep n={1} surface="site">Join the team and sign in to KaraBuddy.</TrackStep>
                <TrackStep n={2} surface="ext">Install the KaraBuddy extension if you don&apos;t have it yet.</TrackStep>
                <TrackStep n={3} surface="ext">Open the <strong style={strong}>key manager</strong> and paste the team key your lead sent you.</TrackStep>
                <TrackStep n={4} surface="ext">Done — recording on karabast.net encrypts automatically, and the team&apos;s replays open for you.</TrackStep>
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          <h2 style={h2}>What&apos;s protected — and what isn&apos;t</h2>
          <p style={p}><strong style={strong}>Hidden from KaraBuddy:</strong> the full replay (every gamestate), the leaders/bases/decks both players ran, opponent usernames, your comments, and any display names or labels.</p>
          <p style={p}><strong style={strong}>Still visible (the honest part):</strong> KaraBuddy can see <em>that</em> a member uploaded an encrypted replay to a team, when, how long it ran, and roughly how many actions it had — plus the key&apos;s public fingerprint. It cannot see anything about <em>what</em> was played. Removing even this metadata would require self-hosting (not offered yet).</p>
          <p style={{ ...p, marginBottom: 0 }}><strong style={strong}>Turned off for private teams:</strong> public sharing, server-side stats, and search — those need to read content the server can&apos;t see.</p>
        </Panel>

        <Panel>
          <h2 style={h2}>Turning it on &amp; using it</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Step n={1} title="Owner: enable it">
              On your team&apos;s <strong style={strong}>Settings</strong> tab, open <strong style={strong}>Private (encrypted) mode</strong> →
              <strong style={strong}> Make this team private</strong>. That opens the extension&apos;s key manager, where
              <strong style={strong}> Generate key &amp; turn on private mode</strong> creates the key and switches encryption on in one step.
            </Step>
            <Step n={2} title="Share the key with your team">
              Copy the key from the key manager and send it to teammates <strong style={strong}>out-of-band</strong> (not through KaraBuddy).
              The key stays in the extension on your device — you can show it again anytime — but back it up somewhere safe, since it
              can&apos;t be recovered if everyone loses it.
            </Step>
            <Step n={3} title="Members: load the key">
              Each teammate opens the KaraBuddy extension&apos;s key manager (the &ldquo;Open key manager&rdquo; button on any private
              replay, or the toolbar icon), finds the team, and pastes the key. It&apos;s stored only on their device.
            </Step>
            <Step n={4} title="Record &amp; review as normal">
              With the key loaded, recording uploads encrypted, and replays/comments just work. Without it, the extension
              keeps recordings local and never uploads plaintext — so a private team can&apos;t leak by mistake.
            </Step>
          </div>
        </Panel>

        <Panel accent>
          <h2 style={h2}>Don&apos;t trust us — verify it</h2>
          <p style={p}>The whole point is that you don&apos;t have to take our word for it. The extension is open source and small enough to audit.</p>
          <p style={p}>
            <strong style={strong}>1. Read the crypto.</strong> All of the encryption is one short, dependency-free file —{' '}
            <Link href={`${GITHUB}/blob/main/lib/e2ee.js`} style={link} target="_blank" rel="noreferrer"><code style={code}>lib/e2ee.js</code></Link>{' '}
            (mirrored byte-for-byte into the extension). A few minutes&apos; read covers the entire trusted surface.
          </p>
          <p style={p}>
            <strong style={strong}>2. Confirm the key never leaves your device.</strong> The key lives only in the extension&apos;s
            storage — never in a KaraBuddy web page (a compromised page could otherwise steal it). When the site shows you an
            encrypted replay it <em>asks the extension to decrypt</em>; the plaintext comes back, the key never does. The page can
            only call a small allowlisted set of actions — see{' '}
            <Link href={`${GITHUB}/blob/main/extension/karabuddy-bridge.js`} style={link} target="_blank" rel="noreferrer"><code style={code}>karabuddy-bridge.js</code></Link>.
          </p>
          <p style={p}>
            <strong style={strong}>3. The fingerprint isn&apos;t your key.</strong> The id KaraBuddy stores is a one-way fingerprint of
            the key (used only to know which key a replay needs). It can&apos;t be reversed into the key, and key-matching happens
            on your device — your key is never compared on a server.
          </p>
          <p style={{ ...p, marginBottom: 0 }}>
            <strong style={strong}>4. The published build matches the source.</strong> The extension is buildless plain
            JavaScript with no transpile step, so you can rebuild the released <code style={code}>.zip</code> from its git tag and
            confirm it matches what&apos;s in the Chrome Web Store — what you audit on{' '}
            <Link href={`${GITHUB}/tree/main/extension`} style={link} target="_blank" rel="noreferrer">GitHub</Link> is exactly what runs.
          </p>
        </Panel>

        <Panel>
          <h2 style={h2}>Good to know</h2>
          <p style={p}><strong style={strong}>No recovery.</strong> If everyone loses the key, the encrypted replays can&apos;t be read — by anyone, including us. Keep it backed up.</p>
          <p style={p}><strong style={strong}>Rotation is forward-only.</strong> You can rotate to a new key (e.g. when someone leaves): your existing replays get re-encrypted under the new key, and you share the new key with current teammates (they add it before you run the rotation, so no one loses access). But anyone who had the old key already saw what they saw — rotation protects what comes next, not the past.</p>
          <p style={{ ...p, marginBottom: 0 }}><strong style={strong}>Viewing needs the extension.</strong> Because the key lives in the extension, private replays open only in a browser with KaraBuddy installed and the key loaded — there&apos;s no plain-web link view.</p>
        </Panel>
      </div>

      <p style={{ marginTop: 28, fontSize: 13, color: '#6c7588' }}>
        Questions about data handling? See the <Link href="/privacy" style={link}>privacy page</Link>.
      </p>
    </main>
  );
}
