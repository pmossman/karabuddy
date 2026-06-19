import { desc, eq } from 'drizzle-orm';
import { getDb } from './db';
import { replays } from './schema';
import { orderPlayersOwnerFirst } from './players';

export interface LastReplayRef {
  slug: string;
  label: string;
  players: any[];
  ownerPlayerId: string | null;
  winners: string[] | null;
  createdAt: string;
  // B170 / ADR 0010: private replay — the card decrypts the summary client-side.
  encrypted: boolean;
  teamKeyId: string | null;
  encryptedSummary: string | null;
}

// The signed-in user's most recently recorded replay (their own uploads), for
// the sidebar "jump straight back into your last game" shortcut — a very common
// reason to open karabuddy. Carries the leader/base players + winners so the
// sidebar renders a real replay card (art + W/L), not just text.
export async function getMyLastReplay(userId: string): Promise<LastReplayRef | null> {
  const [row] = await getDb()
    .select({
      slug: replays.slug,
      players: replays.players,
      ownerPlayerId: replays.ownerPlayerId,
      winners: replays.winners,
      displayName: replays.displayName,
      createdAt: replays.createdAt,
      encrypted: replays.encrypted,
      teamKeyId: replays.teamKeyId,
      encryptedSummary: replays.encryptedSummary,
    })
    .from(replays)
    .where(eq(replays.userId, userId))
    .orderBy(desc(replays.createdAt))
    .limit(1);
  if (!row) return null;
  const players = orderPlayersOwnerFirst(row.players as any, row.ownerPlayerId) as any[];
  let label = row.displayName ?? '';
  if (!label) {
    // Encrypted rows hold no plaintext leaders/displayName server-side — the card
    // decrypts the matchup; the text label stays generic.
    if (row.encrypted) label = 'Private replay';
    else {
      const names = players.map((p) => p?.leader?.name).filter(Boolean);
      label = names.length >= 2 ? `${names[0]} vs ${names[1]}` : (names[0] || 'Last game');
    }
  }
  return {
    slug: row.slug,
    label,
    players,
    ownerPlayerId: row.ownerPlayerId ?? null,
    winners: (row.winners as string[] | null) ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    encrypted: !!row.encrypted,
    teamKeyId: row.teamKeyId ?? null,
    encryptedSummary: row.encryptedSummary ?? null,
  };
}
