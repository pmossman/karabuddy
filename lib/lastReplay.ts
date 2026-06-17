import { desc, eq } from 'drizzle-orm';
import { getDb } from './db';
import { replays } from './schema';
import { orderPlayersOwnerFirst } from './players';

export interface LastReplayRef {
  slug: string;
  label: string;
}

// The signed-in user's most recently recorded replay (their own uploads), for
// the sidebar "jump straight back into your last game" shortcut — a very common
// reason to open karabuddy. Label prefers the user's display name, else the
// leader matchup.
export async function getMyLastReplay(userId: string): Promise<LastReplayRef | null> {
  const [row] = await getDb()
    .select({ slug: replays.slug, players: replays.players, ownerPlayerId: replays.ownerPlayerId, displayName: replays.displayName })
    .from(replays)
    .where(eq(replays.userId, userId))
    .orderBy(desc(replays.createdAt))
    .limit(1);
  if (!row) return null;
  const players = orderPlayersOwnerFirst(row.players as any, row.ownerPlayerId) as any[];
  let label = row.displayName ?? '';
  if (!label) {
    const names = players.map((p) => p?.leader?.name).filter(Boolean);
    label = names.length >= 2 ? `${names[0]} vs ${names[1]}` : (names[0] || 'Last game');
  }
  return { slug: row.slug, label };
}
