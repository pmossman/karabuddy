# 0001 — Comment scoping: share-gated, subset-of-shares

**Status:** Accepted (B71/B73, 2026-05-30). Live.

## Context

A tag written for one team appeared in every other team that could see the
replay — a cross-team comment leak. The root cause was the surfacing rule: a
replay reached a team if **any member had tagged it**, so a comment intended
for team A surfaced the whole replay (and its comments) to team B that shared a
member.

## Decision

1. **A replay reaches a team only via an explicit share** (`replay_team_shares`),
   never "a member tagged it." This removes the implicit surfacing path.
2. **Each tag carries a team scope** (`tag_team_scope`): a subset of the
   replay's shares. Empty scope = personal (author-only).
3. **The server is the security boundary.** `lib/tagScope.resolveTagScope`
   clamps every write to `audience ⊆ replay shares ∩ author memberships`.
   Anonymous authors are always personal.
4. **One shared narrowing rule, two surfaces.** `lib/commentScope.js` computes
   the draft scope from @-mentions (0 mentions → all armed; ≥1 → mentioned
   people's teams ∩ armed). The extension uses a byte-for-byte copy
   (`extension/replays/00-comment-scope.js`), kept identical by
   `sync:extension-shared` and asserted by `commentScope.parity.test.ts`. It's
   a UX convenience — the server re-clamps regardless.
5. **Reads are scoped at every site:** discussion feed (scope inner-join),
   viewer (client-fetch `GET /api/replays/[slug]/tags`, authed by session /
   `X-Install-Token`), mentions inbox (EXISTS gate).

## Consequences

- A pre-B71 backfill was needed (`backfillTagScopes`) to recover scope for
  existing tags — one-shot, not idempotent, run once at cutover.
- The extension change to send armed teams on upload required a CWS release;
  until users updated, in-game tags defaulted to personal.
- Touching tag visibility means touching `lib/tagScope.ts` first — don't add a
  read path that bypasses the scope join.
- **Replies (B78)** extend the model rather than bypass it: a reply inherits its
  parent's scope (fed to `resolveTagScope` as the requested set), so its
  audience ⊆ the parent's and the security boundary is unchanged.
