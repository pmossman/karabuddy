import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, users } from '@/lib/schema';
import { matchChips } from '@/lib/matchMetadata';
import { orderPlayersOwnerFirst } from '@/lib/players';
import { isSampleReplaySlug } from '@/lib/sampleReplays';
import { anonymizeDecks, anonByIdFromPlayers } from '@/lib/anonymizeReplay';
import { auth } from '@/auth';
import { canViewReplayIdentities } from '@/lib/altPerspective';
import type { DecksByUserId } from '@/lib/replayDecoder';
import { DecksTabs } from '../../DecksTabs';

export const dynamic = 'force-dynamic';

// B58/B65b: per-replay deck page. The URL is per-player + shareable, but it
// renders the SAME tabbed per-player experience as the in-viewer DecksModal
// (shared <DecksTabs>): switch players, and the opponent tab shows the cards we
// saw them play. The deck snapshot (jsonb column) only has the recorder's full
// list, so opponents' "seen during play" is decoded from the payload server-side
// here (the viewer reuses its client-decoded frames instead).

interface PageProps {
  params: Promise<{ slug: string; playerId: string }>;
}

export default async function DeckPage({ params }: PageProps) {
  const { slug, playerId } = await params;

  const db = getDb();
  const rows = await db
    .select({ replay: replays, ownerName: users.name })
    .from(replays)
    .leftJoin(users, eq(users.id, replays.userId))
    .where(eq(replays.slug, slug))
    .limit(1);
  if (rows.length === 0) notFound();
  const { replay, ownerName: rawOwnerName } = rows[0];

  // B122: full deck lists are private — only the uploader or a teammate may see
  // them. Curated samples (B107) are anonymized but keep the demo decklist.
  const isSample = isSampleReplaySlug(slug);
  const session = await auth();
  const viewerUserId = session?.user?.id ?? null;
  const canView = isSample ? false : await canViewReplayIdentities(replay as any, { sessionUserId: viewerUserId, installToken: null });
  if (!isSample && !canView) {
    return (
      <main style={mainStyle}>
        <BackLink slug={slug} />
        <h1 style={h1Style}>Deck list is private</h1>
        <p style={{ fontSize: 13, color: '#a0a8b8', lineHeight: 1.5, marginTop: 8 }}>
          Deck lists are only visible to the player who recorded this replay and
          their teammates. You can still <Link href={`/r/${slug}`} style={{ color: '#5db4ff', textDecoration: 'none' }}>watch the replay →</Link>
        </p>
      </main>
    );
  }

  // identity anonymization: samples → "Player N" + drop deck title + uploader name.
  const anonymize = isSample;
  const ownerName = anonymize ? null : rawOwnerName;
  let decks = (replay.decks as DecksByUserId | null) || null;
  if (anonymize && decks) {
    const ordered = orderPlayersOwnerFirst((replay as any).players, (replay as any).ownerPlayerId);
    decks = anonymizeDecks(decks, anonByIdFromPlayers(ordered as any[])) as DecksByUserId;
  }
  if (!decks) {
    return (
      <main style={mainStyle}>
        <BackLink slug={slug} />
        <h1 style={h1Style}>Deck snapshot unavailable</h1>
        <p style={{ fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
          No deck snapshot was captured for this replay. Replays recorded before
          the karabuddy extension started capturing deck data don&apos;t have one.
          Newer replays will show the full deck here.
        </p>
      </main>
    );
  }
  if (!decks[playerId]) notFound();

  const ownerPlayerId = ((replay as any).ownerPlayerId as string | null) ?? null;
  // B65b: the opponent's deck is masked in the snapshot (leader/base only), so
  // <DecksTabs> lazily fetches + decodes the payload client-side to surface what
  // we saw them play (same path the viewer uses). Skip for encrypted replays —
  // the ciphertext can't be decoded without the team key.
  const payloadBlobUrl = (replay as any).encrypted ? undefined : ((replay as any).payloadBlobUrl as string | undefined);

  const chips = matchChips((replay.match as any) || null);

  return (
    <main style={mainStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <Link href={`/r/${slug}`} style={{ color: '#5db4ff', fontSize: 13, textDecoration: 'none' }}>
          ← View replay
        </Link>
        {ownerName && <span style={{ fontSize: 12, color: '#6c7588' }}>uploaded by {ownerName}</span>}
        {chips.map((c) => <span key={c} style={chipStyle}>{c}</span>)}
      </div>
      <div style={panelStyle}>
        <DecksTabs
          decks={decks}
          localPlayerId={ownerPlayerId}
          initialPlayerId={playerId}
          payloadBlobUrl={payloadBlobUrl}
        />
      </div>
    </main>
  );
}

function BackLink({ slug }: { slug: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Link href={`/r/${slug}`} style={{ color: '#5db4ff', fontSize: 13, textDecoration: 'none' }}>
        ← View replay
      </Link>
    </div>
  );
}

const mainStyle: React.CSSProperties = {
  maxWidth: 'min(1600px, 96vw)',
  margin: '0 auto',
  padding: '20px 20px 64px',
  color: '#e6e6e6',
  fontFamily: 'var(--font-barlow), sans-serif',
};
const h1Style: React.CSSProperties = { margin: 0, fontSize: 26, fontWeight: 600 };
const chipStyle: React.CSSProperties = {
  background: 'rgba(77, 157, 255, 0.12)',
  border: '1px solid rgba(77, 157, 255, 0.3)',
  color: '#a7d2ff',
  borderRadius: 999,
  padding: '2px 10px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};
const panelStyle: React.CSSProperties = {
  border: '1px solid #2e333c',
  borderRadius: 12,
  background: 'rgba(20, 24, 31, 0.6)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};
