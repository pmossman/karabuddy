// Resolve a userId for an incoming upload or tag mutation. Priority:
//   1. Active web session (signed-in browser caller).
//   2. Extension token mapping (this install previously linked to a user).
//   3. Null (anonymous — token-only attribution).
//
// B84: the karabast-username match path was removed — the extension's
// install-token→account link is the only bridge; karabast username is never
// used for attribution. The same helper drives /api/replays POST + tag CRUD.
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { extensionTokens } from '@/lib/schema';

// Convenience: same resolution as resolveUserId, but the install token
// is sourced from the request's X-Install-Token header. Use this on
// read-only "who am I" endpoints called from the extension SW where
// Auth.js's SameSite=Lax cookies don't reliably ride along on cross-
// origin extension fetches — the install token (already linked to a
// user via `extension_tokens`) gets us the same answer without
// depending on cookie semantics.
export async function resolveUserIdFromRequest(req: Request): Promise<string | null> {
  return resolveUserId({ installToken: req.headers.get('x-install-token') });
}

export async function resolveUserId(opts: {
  installToken?: string | null;
}): Promise<string | null> {
  const session = await auth();
  const sessionUserId: string | null = (session?.user as any)?.id || null;
  if (sessionUserId) return sessionUserId;
  if (opts.installToken) {
    const db = getDb();
    const [link] = await db
      .select({ userId: extensionTokens.userId })
      .from(extensionTokens)
      .where(eq(extensionTokens.token, opts.installToken))
      .limit(1);
    if (link) return link.userId;
  }
  return null;
}
