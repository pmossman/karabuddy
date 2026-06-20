import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { JoinClient } from './JoinClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ code?: string }>;
}

// B55a: invite acceptance landing. The actual join is a POST to
// /api/teams/join; this page is just a shell that:
//   - shows "missing code" if no ?code= present
//   - redirects to sign-in if not authenticated (preserving the return path)
//   - hands off to JoinClient which calls the API + redirects on success
export default async function TeamJoinPage({ searchParams }: PageProps) {
  const { code } = await searchParams;
  const session = await auth();
  const userId: string | null = session?.user?.id || null;

  if (!code) {
    return (
      <main style={{ maxWidth: 520, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
        <h1 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 600 }}>Missing invite code</h1>
        <p style={{ margin: 0, fontSize: 13, color: '#a0a8b8' }}>
          This link is missing its invite code. Ask whoever shared it to send the full link.
        </p>
      </main>
    );
  }

  if (!userId) {
    // Round-trip through sign-in then come back to this same URL with code intact.
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/teams/join?code=${code}`)}`);
  }

  return <JoinClient code={code} />;
}
