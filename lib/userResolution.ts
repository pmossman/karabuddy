// Resolve a userId for an incoming upload or tag mutation. Priority:
//   1. Active web session (signed-in browser caller).
//   2. Extension token mapping (this install previously linked to a user).
//   3. Karabast-username match (someone registered with karabastUsername =
//      the upload's recorded player username — the soft path-2 bridge).
//   4. Null (anonymous — token-only attribution).
//
// The same helper drives /api/replays POST + tag CRUD, so attribution is
// consistent across surfaces.
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { extensionTokens, users } from '@/lib/schema';

export async function resolveUserId(opts: {
  installToken?: string | null;
  recordedUsername?: string | null;
}): Promise<string | null> {
  const session = await auth();
  const sessionUserId: string | null = (session?.user as any)?.id || null;
  if (sessionUserId) return sessionUserId;
  const db = getDb();
  if (opts.installToken) {
    const [link] = await db
      .select({ userId: extensionTokens.userId })
      .from(extensionTokens)
      .where(eq(extensionTokens.token, opts.installToken))
      .limit(1);
    if (link) return link.userId;
  }
  if (opts.recordedUsername) {
    const [match] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.karabastUsername, opts.recordedUsername))
      .limit(1);
    if (match) return match.id;
  }
  return null;
}
