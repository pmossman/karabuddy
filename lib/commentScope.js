// B71: SHARED comment-scope logic. Dependency-free plain JS so the exact
// same rule runs in the karabuddy web viewer (imported as TS via allowJs)
// AND in the buildless extension (copied verbatim into extension/ at
// package time). Keeping this one file authoritative is what makes the
// mid-match and karabuddy commenting behave identically by default.
//
// The rule (locked with Parker): a comment's audience is a subset of the
// teams the replay is shared with ("armed"). Mentions drive the narrowing
// live:
//   0 mentions  → all armed teams (broadcast).
//   ≥1 mention  → the UNION of the mentioned people's teams, intersected
//                 with armed (so you can never scope past the shares, and
//                 a mention can't reach a team the replay isn't shared with).
//
// Pure + synchronous: callers feed it the armed set, the current mentions,
// and a userId→teams map (from the same mention-data the autocomplete uses).
// The server independently re-clamps via lib/tagScope.resolveTagScope, so
// this is a UX convenience, not the security boundary.

/**
 * @param {Object} input
 * @param {string[]} input.armedTeams       team slugs the replay is shared with (upper bound)
 * @param {string[]} input.mentionedUserIds user ids currently @-mentioned in the draft
 * @param {Record<string, string[]>} input.memberTeams userId → team slugs they belong to
 * @returns {string[]} effective scope — a subset of armedTeams, in armedTeams order
 */
export function scopeFromMentions(input) {
  const armed = (input && input.armedTeams) || [];
  const mentioned = (input && input.mentionedUserIds) || [];
  const memberTeams = (input && input.memberTeams) || {};

  // No teams armed → personal, regardless of mentions (can't scope a
  // comment onto a replay that isn't shared with anyone).
  if (armed.length === 0) return [];
  // No mentions → broadcast to every armed team.
  if (mentioned.length === 0) return armed.slice();

  const wanted = new Set();
  for (const uid of mentioned) {
    const teams = memberTeams[uid] || [];
    for (const t of teams) wanted.add(t);
  }
  // Intersect with armed, preserving armed order for a stable chip readout.
  return armed.filter((t) => wanted.has(t));
}

/**
 * Human-readable label for the scope chip, given the effective scope and a
 * teamSlug→name map. Shared so web + extension render the same wording.
 * @param {string[]} scope          effective scope (from scopeFromMentions)
 * @param {string[]} armedTeams     the full armed set (to detect "all")
 * @param {Record<string,string>} teamNames teamSlug → display name
 * @returns {string}
 */
export function scopeLabel(scope, armedTeams, teamNames) {
  const names = (teamNames) || {};
  if (!scope || scope.length === 0) return 'Just me';
  if (armedTeams && scope.length === armedTeams.length) {
    return `All ${scope.length} team${scope.length === 1 ? '' : 's'}`;
  }
  if (scope.length === 1) return `${names[scope[0]] || scope[0]} only`;
  return scope.map((s) => names[s] || s).join(', ');
}
