import Link from 'next/link';
import { eq, desc } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, users } from '@/lib/schema';
import { MineEmpty } from './MineEmpty';
import { MineAnonymous } from './MineAnonymous';
import { ReplayFilters } from './ReplayFilters';

export const dynamic = 'force-dynamic';

type Tab = 'mine' | 'public';

interface PageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function ReplaysIndex({ searchParams }: PageProps) {
  const { tab: tabParam } = await searchParams;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  // B54: default to mine for everyone — anonymous viewers fall through to
  // MineAnonymous which can still surface their extension's replays.
  // Public stays explicit (?tab=public) to avoid surprise.
  const tab: Tab = tabParam === 'public' ? 'public' : 'mine';

  const db = getDb();
  // LEFT JOIN users so we can surface the uploader display name in the
  // new Member column without an N+1. Anonymous-owned replays (userId
  // null) leave ownerName as null and the column renders "—".
  const baseSelect = db
    .select({ replay: replays, ownerName: users.name })
    .from(replays)
    .leftJoin(users, eq(users.id, replays.userId));
  let rows: { replay: typeof replays.$inferSelect; ownerName: string | null }[] = [];
  if (tab === 'mine' && userId) {
    rows = await baseSelect.where(eq(replays.userId, userId)).orderBy(desc(replays.createdAt)).limit(100);
  } else if (tab === 'public') {
    rows = await baseSelect.where(eq(replays.visibility, 'public')).orderBy(desc(replays.createdAt)).limit(50);
  }

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      <h1 style={{ margin: '0 0 20px', fontSize: 26, fontWeight: 600 }}>Replays</h1>
      <Tabs current={tab} signedIn={!!userId} />
      {tab === 'mine' && !userId ? (
        // B54: anonymous viewers can still see THEIR OWN replays via the
        // extension's install token. MineAnonymous probes the bridge,
        // fetches `?owner=<token>`, and falls through to MineEmpty (install
        // pitch) if there's no extension.
        <MineAnonymous />
      ) : (
        // B52: filter UI sits above the grid. ReplayFilters handles
        // chip bar + filter application + grid render.
        <ReplayFilters
          rows={rows.map(serializeRow)}
          canManage={tab === 'mine'}
          emptyState={tab === 'mine' ? <MineEmpty /> : <Empty tab={tab} />}
        />
      )}
    </main>
  );
}

function serializeRow({ replay: r, ownerName }: { replay: any; ownerName: string | null }) {
  return {
    slug: r.slug,
    gameId: r.gameId,
    userId: r.userId,
    players: r.players,
    durationMs: r.durationMs,
    actionCount: r.actionCount,
    visibility: r.visibility,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    // B42: pass match meta so the card teaser can render a format chip.
    // Decks are intentionally excluded here — too much payload for a list
    // page; the viewer loads them on demand.
    match: r.match ?? null,
    // B53: user-set display name + labels for the teaser.
    displayName: r.displayName ?? null,
    labels: r.labels ?? null,
    // B59: winning playerIds (matches player.id in players[]) — drives
    // the W/L badges in table / grid / viewer.
    winners: r.winners ?? null,
    // B59-followup: which player was the owner (recorder POV). Used by
    // the "Wins" filter to ask "did I win?" per row.
    ownerPlayerId: r.ownerPlayerId ?? null,
    // Uploader display name for the Member column in the table view.
    // Null for anonymous uploads — TableView renders "—" in that case.
    ownerName,
  };
}

function Tabs({ current, signedIn }: { current: Tab; signedIn: boolean }) {
  const link = (tab: Tab, label: string) => (
    <Link
      key={tab}
      href={`/replays?tab=${tab}`}
      style={{
        color: current === tab ? '#e6e6e6' : '#6c7588',
        fontSize: 14,
        fontWeight: 600,
        padding: '8px 14px',
        textDecoration: 'none',
        borderRadius: 6,
        background: current === tab ? 'rgba(74, 124, 255, 0.12)' : 'transparent',
        border: current === tab ? '1px solid rgba(74, 124, 255, 0.4)' : '1px solid transparent',
      }}
    >
      {label}
    </Link>
  );
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {signedIn && link('mine', 'My replays')}
      {link('public', 'Public')}
    </div>
  );
}

function Empty({ tab }: { tab: Tab }) {
  return (
    <div style={{ marginTop: 32, padding: 32, border: '1px dashed #2e333c', borderRadius: 8, textAlign: 'center', color: '#6c7588' }}>
      {tab === 'mine'
        ? 'No replays yet. Record one with the KaraBuddy chrome extension on karabast.net.'
        : 'No public replays yet.'}
    </div>
  );
}
