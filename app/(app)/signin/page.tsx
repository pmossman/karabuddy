import { signIn, auth } from '@/auth';
import { redirect } from 'next/navigation';

interface PageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

// Map Auth.js error codes to human-readable explanations. The full list
// is at https://authjs.dev/reference/errors
const ERROR_COPY: Record<string, string> = {
  OAuthAccountNotLinked:
    'That email is already used by another sign-in method. Sign in with the original provider, then we can link the new one from settings.',
  AccessDenied: 'Sign-in was denied by the provider.',
  Verification: 'The verification link is no longer valid.',
  Configuration: 'Sign-in is misconfigured. Check the server logs.',
  Default: 'Something went wrong signing in.',
};

export default async function SignInPage({ searchParams }: PageProps) {
  const session = await auth();
  const params = await searchParams;
  const callbackUrl = params.callbackUrl || '/';
  const error = params.error;
  if (session?.user) redirect(callbackUrl);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          background: 'rgba(17, 20, 26, 0.75)',
          border: '1px solid #2e333c',
          borderRadius: 12,
          padding: '36px 40px',
          maxWidth: 420,
          width: '100%',
          color: '#e6e6e6',
          backdropFilter: 'blur(10px)',
        }}
      >
        <h1 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 600 }}>Sign in</h1>
        <p style={{ fontSize: 14, color: '#a0a8b8', margin: '0 0 24px', lineHeight: 1.5 }}>
          Sign in to claim your replays, tag with your name, and link your karabast.net account.
          You can also keep browsing as a guest.
        </p>
        {error && (
          <div
            style={{
              marginBottom: 20,
              padding: '12px 14px',
              background: 'rgba(255, 107, 107, 0.1)',
              border: '1px solid rgba(255, 107, 107, 0.3)',
              borderRadius: 8,
              color: '#ff8a8a',
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            {ERROR_COPY[error] || ERROR_COPY.Default}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <form action={async () => { 'use server'; await signIn('discord', { redirectTo: callbackUrl }); }}>
            <ProviderButton color="#5865F2" label="Continue with Discord" />
          </form>
          <form action={async () => { 'use server'; await signIn('google', { redirectTo: callbackUrl }); }}>
            <ProviderButton color="#ffffff" textColor="#1a1d23" label="Continue with Google" />
          </form>
        </div>
        <p style={{ fontSize: 11, color: '#6c7588', marginTop: 24, lineHeight: 1.5 }}>
          karabuddy uses the same provider IDs as karabast.net &mdash; signing in with the Discord
          or Google account you use there means your karabast username can be auto-detected on
          replay upload.
        </p>
      </div>
    </main>
  );
}

function ProviderButton({ color, textColor = '#ffffff', label }: { color: string; textColor?: string; label: string }) {
  return (
    <button
      type="submit"
      style={{
        width: '100%',
        padding: '12px 16px',
        background: color,
        color: textColor,
        border: 0,
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}
