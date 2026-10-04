import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/schema';

export async function getDismissedAnnouncementVersion(userId: string): Promise<number | null> {
  const [row] = await getDb()
    .select({ version: users.announcementDismissedVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.version ?? null;
}

export async function dismissAnnouncement(userId: string, version: number): Promise<void> {
  await getDb()
    .update(users)
    .set({ announcementDismissedVersion: sql`greatest(${users.announcementDismissedVersion}, ${version})` })
    .where(eq(users.id, userId));
}
