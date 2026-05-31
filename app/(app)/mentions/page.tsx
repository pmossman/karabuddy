import Link from 'next/link';
import { auth } from '@/auth';
import { MentionsList } from './MentionsList';
import { glowButtonStyle } from '@/app/_components/glowButton';

export const dynamic = 'force-dynamic';

// B55d: mentions inbox. Lists tags that mention the signed-in user OR
// any of their teams. Click → jump to the tagged frame on the replay.
// Account-gated; anonymous viewers see a sign-in prompt.
export default async function MentionsPage() {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '32px 28px 80px',
        color: '#e6e6e6',
        fontFamily: 'var(--font-barlow), sans-serif',
      }}
    >
      <h1 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 600 }}>Mentions</h1>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
        Tags where you or one of your teams were @-mentioned. Click any item to
        jump to the exact frame on the replay.
      </p>
      {!userId ? (
        <div style={{ padding: 32, border: '1px dashed #2e333c', borderRadius: 8, textAlign: 'center' }}>
          <p style={{ margin: 0, color: '#a0a8b8', fontSize: 13 }}>Sign in to see your mentions.</p>
          <Link
            href="/signin?callbackUrl=/mentions"
            style={{ ...glowButtonStyle, marginTop: 16 }}
          >
            Sign in
          </Link>
        </div>
      ) : (
        <MentionsList />
      )}
    </main>
  );
}
