// Pure predicate module for replay + tag mutation permissions.
//
// Every server route AND the client viewer asks the same questions:
//   - "Can the caller mutate THIS replay?" (visibility, title, labels,
//     team-shares, deletion)
//   - "Can the caller edit THIS tag?" (text + mentions — author only)
//   - "Can the caller delete THIS tag?" (author OR replay owner)
//
// Caller context is uniform: a signed-in user id (or null) + an
// extension install token (or null). The functions are pure — no DB,
// no auth() — so the client can import them too and gate UI from
// exactly the same source of truth the server enforces with.
//
// B7 split: authors get edit; replay owners get delete-only on others'
// tags. Don't let replay owners rewrite other people's words.

export interface AuthContext {
  sessionUserId: string | null;
  installToken: string | null;
}

// userId is optional + nullable — DB rows have it nullable; client-side
// TagRow has it marked optional. Accept both shapes.
interface ReplayOwnership {
  userId?: string | null;
  ownerToken: string;
}

interface TagAuthorship {
  userId?: string | null;
  authorToken: string;
}

// Can the caller mutate this replay (visibility, title, labels, shares,
// deletion)? True iff session matches replay.userId OR install token
// matches replay.ownerToken.
export function canMutateReplay(replay: ReplayOwnership, ctx: AuthContext): boolean {
  if (ctx.sessionUserId && replay.userId === ctx.sessionUserId) return true;
  if (ctx.installToken && replay.ownerToken === ctx.installToken) return true;
  return false;
}

// Can the caller edit this tag's text? Author-only; replay owners
// can't rewrite other people's tags.
export function canEditTag(tag: TagAuthorship, ctx: AuthContext): boolean {
  if (ctx.sessionUserId && tag.userId === ctx.sessionUserId) return true;
  if (ctx.installToken && tag.authorToken === ctx.installToken) return true;
  return false;
}

// Can the caller delete this tag? Tag author OR the replay's owner.
// Replay owner = canMutateReplay applied to the parent replay row.
export function canDeleteTag(
  tag: TagAuthorship,
  replay: ReplayOwnership,
  ctx: AuthContext,
): boolean {
  return canEditTag(tag, ctx) || canMutateReplay(replay, ctx);
}

// Convenience: build the AuthContext from a Next request + Auth.js
// session. Server-side only (calls into the Request to read the
// X-Install-Token header). Keeps callers' boilerplate to one line.
export function authContextFromRequest(req: Request, sessionUserId: string | null): AuthContext {
  return {
    sessionUserId,
    installToken: req.headers.get('x-install-token'),
  };
}
