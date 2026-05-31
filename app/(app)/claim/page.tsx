import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq, and, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, tags, extensionTokens } from '@/lib/schema';
import { ClaimForm } from './ClaimForm';
import { AutoDetectExtension } from './AutoDetectExtension';

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ClaimPage({ searchParams }: PageProps) {
  const { token: tokenParam } = await searchParams;
  const token = (tokenParam || '').trim();
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;

  // Not signed in? Send to /signin, come back with the same ?token preserved.
  if (!userId) {
    const cb = token ? `/claim?token=${encodeURIComponent(token)}` : '/claim';
    redirect(`/signin?callbackUrl=${encodeURIComponent(cb)}`);
  }

  // No token in URL — try to read it from the installed extension via the
  // postMessage bridge. If the extension is present + active, this is a
  // zero-friction button-press flow; if not, we show useful instructions
  // instead of a confusing "paste your token" field.
  if (!token) {
    return <Frame>
      <h2 style={h2}>Link your extension</h2>
      <AutoDetectExtension />
    </Frame>;
  }

  // Show what claiming this token would do: count unclaimed replays + tags.
  const db = getDb();
  const orphanReplays = await db
    .select({ slug: replays.slug })
    .from(replays)
    .where(and(eq(replays.ownerToken, token), sql`${replays.userId} IS NULL`));
  const orphanTags = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.authorToken, token), sql`${tags.userId} IS NULL`));
  const [existingLink] = await db
    .select()
    .from(extensionTokens)
    .where(eq(extensionTokens.token, token))
    .limit(1);

  if (existingLink && existingLink.userId === userId) {
    return <Frame>
      <h2 style={h2}>Already linked</h2>
      <p style={muted}>This extension is already linked to your account.</p>
      <Link href="/replays" style={primaryLink}>Go to My Replays →</Link>
    </Frame>;
  }
  if (existingLink && existingLink.userId !== userId) {
    return <Frame>
      <h2 style={h2}>Token in use</h2>
      <p style={muted}>This token is currently linked to a different account. If that&apos;s your other account, sign in there to manage it; otherwise reach out to the original owner.</p>
    </Frame>;
  }

  return <Frame>
    <h2 style={h2}>Link this extension to your account</h2>
    <p style={muted}>
      The extension with this token has uploaded <strong>{orphanReplays.length}</strong> replay(s) and
      authored <strong>{orphanTags.length}</strong> tag(s) under your install token. Linking will:
    </p>
    <ul style={{ ...muted, paddingLeft: 22, marginBottom: 20 }}>
      <li>Attribute every existing replay and tag to your account.</li>
      <li>Auto-attribute every <em>future</em> upload from this extension to you.</li>
    </ul>
    <ClaimForm prefilledToken={token} confirmLabel="Link extension" />
  </Frame>;
}

const h2: React.CSSProperties = { margin: '0 0 12px', fontSize: 20, fontWeight: 600 };
const muted: React.CSSProperties = { fontSize: 13, color: '#a0a8b8', lineHeight: 1.5, margin: '0 0 16px' };
const primaryLink: React.CSSProperties = { display: 'inline-block', marginTop: 8, padding: '10px 16px', background: '#4d9dff', color: 'white', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none' };

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 540, margin: '60px auto', padding: '0 28px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      <section style={{ padding: 24, background: 'rgba(17,20,26,0.65)', border: '1px solid #2e333c', borderRadius: 10 }}>
        {children}
      </section>
    </main>
  );
}
