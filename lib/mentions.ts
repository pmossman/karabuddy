// B55c: shared mention parsing + resolution.
//
// Mention syntax in tag comments:
//   - `@<handle>` — user mention. `<handle>` matches users.karabastUsername
//     first, falls back to users.name. Stored on the row as `userIds[]`.
//   - `@team:<slug>` — team mention. `<slug>` is a teams.slug.
//     Stored as `teamSlugs[]`.
//
// Resolution is structural — the client sends the userIds/teamSlugs it
// chose from the autocomplete popover; the server validates that the
// caller has access to mention those targets (must be co-team-member for
// users, must be a member of the team for teams) and persists them.
//
// We DON'T re-parse the comment text server-side, because:
//   1. The autocomplete already disambiguated (e.g. two users named "luke"
//      → the user picked the right userId).
//   2. Free-typed `@something` without selecting from autocomplete is just
//      text — won't notify anyone, which is the right behavior.

export interface MentionStructure {
  userIds: string[];
  teamSlugs: string[];
}

export const EMPTY_MENTIONS: MentionStructure = { userIds: [], teamSlugs: [] };

// Normalize a mentions value off a tag row (which could be null on
// pre-B55c rows) into a safe-to-render structure.
export function normalizeMentions(raw: unknown): MentionStructure {
  if (!raw || typeof raw !== 'object') return EMPTY_MENTIONS;
  const userIds = Array.isArray((raw as any).userIds) ? (raw as any).userIds.filter((x: unknown) => typeof x === 'string') : [];
  const teamSlugs = Array.isArray((raw as any).teamSlugs) ? (raw as any).teamSlugs.filter((x: unknown) => typeof x === 'string') : [];
  return { userIds, teamSlugs };
}

// Sanitize a client-submitted mentions structure. Trims to reasonable
// caps; clients can't blast 1000 mentions to spam. De-dupes.
export function sanitizeIncomingMentions(raw: unknown): MentionStructure {
  const norm = normalizeMentions(raw);
  return {
    userIds: Array.from(new Set(norm.userIds)).slice(0, 50),
    teamSlugs: Array.from(new Set(norm.teamSlugs)).slice(0, 10),
  };
}
