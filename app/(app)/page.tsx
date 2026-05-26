import Link from 'next/link';
import { auth } from '@/auth';

// Homepage body. Persistent header is rendered by app/(app)/layout.tsx.
// Keep the hero brand mark here at a larger size for landing-page impact;
// the header's smaller version handles ongoing navigation.
export default async function Home() {
  const session = await auth();
  const signedIn = !!session?.user;

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      <section style={{ marginBottom: 40 }}>
        <div style={{ lineHeight: 0.95, userSelect: 'none' }}>
          <div style={{ fontSize: 56, fontWeight: 400, letterSpacing: 0, textTransform: 'uppercase' }}>KARA</div>
          <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 600, fontSize: 42, color: '#5a8cff', marginLeft: 66, marginTop: -4 }}>buddy</div>
        </div>
        <p style={{ marginTop: 24, fontSize: 16, color: '#a0a8b8', lineHeight: 1.6, maxWidth: 680 }}>
          Replays, solo testing, and review tools for Star Wars Unlimited. Companion to{' '}
          <a href="https://karabast.net" style={{ color: '#5a8cff' }}>karabast.net</a>.
        </p>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <Tile
          title="Browse replays"
          desc="See games other players have made public."
          href="/replays?tab=public"
          cta="Browse"
        />
        {signedIn ? (
          <Tile
            title="My replays"
            desc="Manage replays uploaded under your account. Toggle visibility, delete, share."
            href="/replays?tab=mine"
            cta="View"
          />
        ) : (
          <Tile
            title="Sign in"
            desc="Sign in to manage your replays and link them to your karabast.net identity."
            href="/signin"
            cta="Sign in"
            accent
          />
        )}
        <Tile
          title="Chrome extension"
          desc="Record karabast.net games as you play. Replays upload here automatically and you can tag moments mid-game."
          href="https://github.com/pmossman/karabast-extension"
          cta="Install"
          external
        />
      </section>

      <section style={{ marginTop: 48, padding: 20, border: '1px dashed #2e333c', borderRadius: 8, color: '#6c7588', fontSize: 13, lineHeight: 1.5 }}>
        <strong style={{ color: '#a0a8b8' }}>Already have replays from the extension?</strong>
        {' '}
        Link your install to your account at{' '}
        <Link href="/claim" style={{ color: '#5a8cff' }}>/claim</Link> &mdash; one-time setup, all
        your past + future uploads attribute to you.
      </section>
    </main>
  );
}

function Tile({ title, desc, href, cta, external = false, accent = false }: { title: string; desc: string; href: string; cta: string; external?: boolean; accent?: boolean }) {
  const Comp: any = external ? 'a' : Link;
  const props = external ? { href, target: '_blank', rel: 'noreferrer' } : { href };
  return (
    <Comp
      {...props}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 20,
        background: accent ? 'rgba(74, 124, 255, 0.12)' : 'rgba(17, 20, 26, 0.6)',
        border: `1px solid ${accent ? 'rgba(74, 124, 255, 0.4)' : '#2e333c'}`,
        borderRadius: 10,
        textDecoration: 'none',
        color: 'inherit',
        transition: 'border-color 120ms ease, transform 120ms ease',
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 600, color: '#e6e6e6' }}>{title}</div>
      <div style={{ fontSize: 13, color: '#a0a8b8', lineHeight: 1.5, flex: 1 }}>{desc}</div>
      <div style={{ fontSize: 12, color: accent ? '#5da9ff' : '#5a8cff', fontWeight: 600, marginTop: 4 }}>{cta} →</div>
    </Comp>
  );
}
