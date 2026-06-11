import { TournamentInvite } from './TournamentInvite';

export const dynamic = 'force-dynamic';

// B126: PUBLIC tournament registration page — the invite code in the URL is
// the capability, so there is deliberately NO auth gate here (guests without
// accounts are the point). Mirrors /teams/join?code=... for teams.
export default async function TournamentJoinPage({ searchParams }: { searchParams: Promise<{ code?: string; claim?: string }> }) {
  const { code, claim } = await searchParams;
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      {code ? (
        <TournamentInvite code={code} claimToken={claim ?? null} />
      ) : (
        <p style={{ fontSize: 13, color: '#a0a8b8' }}>This invite link is missing its code — ask the organizer to re-copy it.</p>
      )}
    </main>
  );
}
